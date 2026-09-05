import { generateKeyPairSync, createVerify } from 'node:crypto'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeApp } from './helpers.ts'
import { FULL_HOST } from './fixtures.ts'
import { AppAuth, appJwt, keyIsPrivate, GitHubForbidden, GitHubRateLimited, GitHubUnavailable } from '../src/services/integrations/github/app.ts'
import { GitHubClient } from '../src/services/integrations/github/client.ts'
import { GitHubIntegration } from '../src/services/integrations/github/index.ts'
import { normaliseInstallation, normaliseRepository } from '../src/services/integrations/github/repositories.ts'
import type { Database } from '../src/db/index.ts'
import type { Overview } from 'portta-contracts'

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()

function keyFile(mode = 0o600, name = 'app.pem'): string {
  const dir = mkdtempSync(join(tmpdir(), 'portta-github-'))
  const path = join(dir, name)
  writeFileSync(path, PEM, { mode })
  chmodSync(path, mode)
  return path
}

const credentials = () => ({ appId: '12345', privateKeyFile: keyFile(), apiUrl: 'https://api.github.test' })

/** A fake GitHub, driven by the test. Nothing here ever touches the network. */
function fakeGitHub(routes: Record<string, { status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: { url: string; authorization: string }[] = []
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString()
    const authorization = String((init?.headers as Record<string, string> | undefined)?.authorization ?? '')
    calls.push({ url: href, authorization })

    // A key the path ends with wins, so `/app/installations/7/access_tokens`
    // is not answered by the `/app/installations` route.
    const path = href.split('?')[0]!
    const key =
      Object.keys(routes).find((candidate) => path.endsWith(candidate)) ??
      Object.keys(routes).find((candidate) => href.includes(candidate))
    const route = key === undefined ? { status: 404, body: { message: 'not found' } } : routes[key]!
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json', ...(route.headers ?? {}) },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the App JWT', () => {
  it('is RS256, signed by the private key and never longer than ten minutes', () => {
    const token = appJwt(credentials(), 1_700_000_000)
    const [header, payload, signature] = token.split('.')

    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as { iat: number; exp: number; iss: string }
    expect(claims.iss).toBe('12345')
    // Issued in the past, because GitHub rejects a token ahead of its clock.
    expect(claims.iat).toBeLessThan(1_700_000_000)
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600)

    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${header}.${payload}`)
    verifier.end()
    expect(verifier.verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true)
  })
})

describe('installation tokens', () => {
  it('are minted once and served from memory until they are near expiry', async () => {
    let now = 1_700_000_000
    const { fetchMock } = fakeGitHub({
      '/access_tokens': { body: { token: 'ghs_secret', expires_at: new Date((now + 3600) * 1000).toISOString() } },
    })
    const auth = new AppAuth(credentials(), () => now)

    expect(await auth.installationToken(1)).toBe('ghs_secret')
    expect(await auth.installationToken(1)).toBe('ghs_secret')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Inside the early-refresh window: minted again rather than sent expiring.
    now += 3400
    await auth.installationToken(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never appears in a status, a log line or an error', async () => {
    fakeGitHub({
      '/access_tokens': { body: { token: 'ghs_secret', expires_at: new Date(Date.now() + 3_600_000).toISOString() } },
      '/app': { body: { slug: 'portta' } },
    })
    const options = { enabled: true, ...credentials() }
    const integration = new GitHubIntegration(options)
    await integration.check()
    expect(JSON.stringify(integration.status())).not.toContain('ghs_secret')
    expect(JSON.stringify(integration.status())).not.toContain('PRIVATE KEY')
  })

  it('turns a refused credential into a typed forbidden', async () => {
    fakeGitHub({ '/access_tokens': { status: 401, body: { message: 'bad credentials' } } })
    const auth = new AppAuth(credentials())
    await expect(auth.installationToken(1)).rejects.toBeInstanceOf(GitHubForbidden)
  })

  it('turns an unreachable GitHub into a typed unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENOTFOUND') }))
    const auth = new AppAuth(credentials())
    await expect(auth.installationToken(1)).rejects.toBeInstanceOf(GitHubUnavailable)
  })
})

describe('the key file', () => {
  it('is only private at mode 600 or narrower', () => {
    expect(keyIsPrivate(keyFile(0o600))).toBe(true)
    expect(keyIsPrivate(keyFile(0o644))).toBe(false)
    expect(keyIsPrivate('/nonexistent/app.pem')).toBe(false)
  })

  // GitHub names the download `<app>.<date>.private-key.pem`, and the operator
  // who keeps that name used to get a passing doctor and a panel reading
  // app.pem. Nothing here may depend on the filename: only the directory is
  // fixed, by the mount.
  it('authenticates under the name GitHub gave it, not only app.pem', async () => {
    const privateKeyFile = keyFile(0o600, 'portta.2026-09-02.private-key.pem')
    const { calls } = fakeGitHub({ '/app': { body: { slug: 'portta' } } })
    const integration = new GitHubIntegration({
      enabled: true, appId: '12345', privateKeyFile, apiUrl: 'https://api.github.test',
    })

    const status = await integration.check()

    expect(status.configured).toBe(true)
    expect(status.available).toBe(true)
    expect(status.reason).toBeNull()
    expect(integration.keyIsPrivate()).toBe(true)

    // Signed by that file, and by the App id beside it.
    const [header, payload, signature] = calls[0]!.authorization.replace('Bearer ', '').split('.')
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${header}.${payload}`)
    verifier.end()
    expect(verifier.verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true)
  })
})

describe('the client', () => {
  it('reads the rate-limit budget from every response', async () => {
    fakeGitHub({
      '/app': {
        body: { slug: 'portta' },
        headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4987', 'x-ratelimit-reset': '1700003600' },
      },
    })
    const client = new GitHubClient(new AppAuth(credentials()), 'https://api.github.test')
    await client.asApp('/app')

    const budget = client.budget()
    expect(budget.limit).toBe(5000)
    expect(budget.remaining).toBe(4987)
    expect(budget.resetAt).toBe(1_700_003_600)
  })

  it('makes an exhausted budget a typed error, not a 500', async () => {
    fakeGitHub({
      '/app': {
        status: 403,
        body: { message: 'rate limit exceeded' },
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700003600' },
      },
    })
    const client = new GitHubClient(new AppAuth(credentials()), 'https://api.github.test')
    await expect(client.asApp('/app')).rejects.toBeInstanceOf(GitHubRateLimited)
  })

  it('follows Link headers to the end', async () => {
    let page = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      page += 1
      const last = page === 2
      return new Response(JSON.stringify([{ id: page }]), {
        status: 200,
        headers: last
          ? { 'content-type': 'application/json' }
          : { 'content-type': 'application/json', link: '<https://api.github.test/next>; rel="next"' },
      })
    }))
    const client = new GitHubClient(new AppAuth(credentials()), 'https://api.github.test')
    const all = await client.paginate<{ id: number }>(
      () => client.asApp('/app/installations'),
      (url) => client.asApp(url),
    )
    expect(all.map((entry) => entry.id)).toEqual([1, 2])
  })
})

describe('normalisation', () => {
  it('keeps enough identity for every later phase', () => {
    expect(
      normaliseInstallation({ id: 7, account: { login: 'acme', type: 'Organization', id: 42 }, permissions: { issues: 'write' } }),
    ).toEqual({
      installationId: 7, accountLogin: 'acme', accountType: 'Organization',
      targetId: 42, suspended: false, permissions: { issues: 'write' },
    })
  })

  it('reads a suspended installation as suspended', () => {
    expect(normaliseInstallation({ id: 7, suspended_at: '2026-01-01T00:00:00Z' }).suspended).toBe(true)
  })

  it('derives the owner when GitHub omits it', () => {
    expect(
      normaliseRepository(
        { id: 1, node_id: 'R_1', name: 'alpha', full_name: 'acme/alpha', private: true, html_url: 'https://github.com/acme/alpha' },
        7,
      ).owner,
    ).toBe('acme')
  })
})

// ---------------------------------------------------------------------------
// The projection and its endpoints
// ---------------------------------------------------------------------------

interface FakeProjection {
  installations: Map<number, unknown>
  repositories: Map<number, unknown>
  sync: Map<string, { cursor: string | null; error: string | null }>
}

function projectionDatabase(): { db: Database; store: FakeProjection } {
  const store: FakeProjection = { installations: new Map(), repositories: new Map(), sync: new Map() }
  const db = {
    status: () => ({ configured: true, available: true, reason: null, checkedAt: 0, migrations: [] }),
    environments: { find: async () => null, upsertSeen: async () => ({}), list: async () => [] },
    settings: { listAllEnvironment: async () => [], listAllService: async () => [] },
    github: {
      upsertInstallation: async (installation: { installationId: number }) =>
        void store.installations.set(installation.installationId, { ...installation, syncedAt: new Date(0) }),
      upsertRepository: async (repository: { githubId: number }) =>
        void store.repositories.set(repository.githubId, { ...repository, id: String(repository.githubId), syncedAt: new Date(0) }),
      listInstallations: async () => [...store.installations.values()],
      listRepositories: async () => [...store.repositories.values()],
      findRepository: async () => null,
      pruneInstallations: async (keep: number[]) => {
        let removed = 0
        for (const id of [...store.installations.keys()]) {
          if (!keep.includes(id)) { store.installations.delete(id); removed += 1 }
        }
        return removed
      },
      pruneRepositories: async (installationId: number, keep: number[]) => {
        let removed = 0
        for (const [id, value] of [...store.repositories.entries()]) {
          const record = value as { installationId: number }
          if (record.installationId === installationId && !keep.includes(id)) {
            store.repositories.delete(id)
            removed += 1
          }
        }
        return removed
      },
      recordSync: async (scope: string, state: { cursor?: string | null; error?: string | null }) =>
        void store.sync.set(scope, { cursor: state.cursor ?? null, error: state.error ?? null }),
      listIssues: async () => [],
      listIssueEnvironments: async () => [],
      listRelationships: async () => [],
      listSyncState: async () =>
        [...store.sync.entries()].map(([scope, value]) => ({
          scope, cursor: value.cursor, lastSyncedAt: new Date(0), lastError: value.error,
        })),
    },
  }
  return { db: db as unknown as Database, store }
}

const INSTALLATION = { id: 7, account: { login: 'acme', type: 'Organization', id: 42 }, permissions: { issues: 'write' } }
const REPOSITORY = {
  id: 101, node_id: 'R_101', name: 'alpha', full_name: 'acme/alpha',
  private: true, html_url: 'https://github.com/acme/alpha', default_branch: 'main',
}

function connected() {
  fakeGitHub({
    '/app/installations': { body: [INSTALLATION] },
    '/access_tokens': { body: { token: 'ghs_secret', expires_at: new Date(Date.now() + 3_600_000).toISOString() } },
    '/installation/repositories': { body: { repositories: [REPOSITORY] } },
    '/app': { body: { slug: 'portta' } },
  })
  return new GitHubIntegration({ enabled: true, ...credentials() })
}

describe('the sync', () => {
  it('is idempotent: two runs leave the same rows', async () => {
    const integration = connected()
    const { db, store } = projectionDatabase()

    const first = await integration.sync(db)
    const second = await integration.sync(db)

    expect(first).toEqual({ installations: 1, repositories: 1, removed: 0 })
    expect(second).toEqual(first)
    expect(store.installations.size).toBe(1)
    expect(store.repositories.size).toBe(1)
  })

  it('drops a repository the installation no longer grants', async () => {
    const integration = connected()
    const { db, store } = projectionDatabase()
    await integration.sync(db)

    fakeGitHub({
      '/app/installations': { body: [INSTALLATION] },
      '/access_tokens': { body: { token: 'ghs_secret', expires_at: new Date(Date.now() + 3_600_000).toISOString() } },
      '/installation/repositories': { body: { repositories: [] } },
    })
    const result = await new GitHubIntegration({ enabled: true, ...credentials() }).sync(db)

    expect(result.removed).toBe(1)
    expect(store.repositories.size).toBe(0)
  })

  it('records the failure rather than losing it', async () => {
    fakeGitHub({ '/app/installations': { status: 500, body: {} } })
    const integration = new GitHubIntegration({ enabled: true, ...credentials() })
    const { db, store } = projectionDatabase()

    await expect(integration.sync(db)).rejects.toBeInstanceOf(GitHubUnavailable)
    expect(store.sync.get('repositories')?.error).toContain('500')
    expect(integration.status().available).toBe(false)
  })
})

describe('the integration endpoints', () => {
  it('answers "not configured" rather than failing, which is the default', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const response = await app.request('/api/integrations/github')
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.status.configured).toBe(false)
    expect(body.installations).toEqual([])
    expect(body.projectionAvailable).toBe(false)
  })

  it('leaves every Docker-backed page working while GitHub is down', async () => {
    fakeGitHub({ '/app': { status: 500, body: {} } })
    const integration = new GitHubIntegration({ enabled: true, ...credentials() })
    await integration.check()

    const { db } = projectionDatabase()
    const { app } = makeApp({ containers: FULL_HOST }, {}, db, integration)

    for (const path of ['/api/status', '/api/environments', '/api/services', '/api/docker/containers']) {
      expect((await app.request(path)).status, path).toBe(200)
    }
    const github = await (await app.request('/api/integrations/github')).json()
    expect(github.status.available).toBe(false)
  })

  it('serves the projected repository list from the database', async () => {
    const integration = connected()
    const { db } = projectionDatabase()
    await integration.sync(db)

    const { app } = makeApp({ containers: FULL_HOST }, {}, db, integration)
    const body = await (await app.request('/api/integrations/github/repositories')).json()
    expect(body.repositories.map((repository: { fullName: string }) => repository.fullName)).toEqual(['acme/alpha'])
  })

  it('answers 503 with a hint for the projection when there is no database', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const response = await app.request('/api/integrations/github/repositories')
    expect(response.status).toBe(503)
  })

  it('returns no token, key or secret anywhere', async () => {
    const integration = connected()
    const { db } = projectionDatabase()
    await integration.sync(db)
    const { app } = makeApp({ containers: FULL_HOST }, {}, db, integration)

    for (const path of ['/api/integrations/github', '/api/integrations/github/repositories', '/api/config', '/api/status']) {
      const text = await (await app.request(path)).text()
      expect(text, path).not.toContain('ghs_secret')
      expect(text, path).not.toContain('PRIVATE KEY')
      expect(text, path).not.toContain('BEGIN RSA')
    }
  })

  it('reports the connection on the overview', async () => {
    const integration = connected()
    await integration.check()
    const { db } = projectionDatabase()
    const { app } = makeApp({ containers: FULL_HOST }, {}, db, integration)

    const overview = (await (await app.request('/api/status')).json()) as Overview
    expect(overview.github?.configured).toBe(true)
    expect(overview.github?.appId).toBe('12345')
  })
})
