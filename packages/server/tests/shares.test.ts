import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { readProtectionStore } from 'portta-core'
import { buildSnapshot } from '../src/services/inventory.ts'
import {
  ShareRefused,
  backendPort,
  collectExpired,
  createShare,
  listShares,
  loadShares,
  parseShares,
  renderShares,
  revokeShare,
} from '../src/services/shares.ts'
import { del, fakeDocker, makeApp, post, testConfig } from './helpers.ts'
import { EXTERNAL, FULL_HOST, GATEWAY, PROJECT_A } from './fixtures.ts'
import type { PanelConfig } from '../src/config.ts'
import type { ContainerSummary, ShareView } from 'portta-contracts'

const PUBLIC = {
  publicEnabled: true,
  publicDomain: 'dev.example.com',
  profile: 'remote-public',
  tlsEnabled: true,
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'portta-shares-'))
})

async function world(overrides: Partial<PanelConfig> = {}) {
  const config = testConfig({ dynamicDir: dir, ...overrides })
  const { client } = fakeDocker({ containers: [...GATEWAY, ...PROJECT_A, ...EXTERNAL] })
  const snapshot = await buildSnapshot(client, config)
  const container = (id: string) =>
    snapshot.containers.find((entry) => entry.id === id) as ContainerSummary
  return { config, snapshot, container }
}

describe('a share is an additional hostname, and nothing about the project changes', () => {
  it('writes a router, a service and an auth middleware, pointing at the container name', async () => {
    const { config, snapshot, container } = await world(PUBLIC)
    const created = await createShare(config, snapshot, container('a-web'), { mode: 'protected' })

    const yaml = readFileSync(join(dir, 'portta-shares.yaml'), 'utf8')
    expect(yaml).toContain(`portta-share-${created.share.id}:`)
    // The container NAME, never the Compose alias: two projects can both
    // alias `web` on the shared network.
    expect(yaml).toContain('url: "http://alpha-web-1:80"')
    expect(yaml).toContain('middlewares: [portta-forward-auth]')
    expect(yaml).not.toContain('basicAuth:')
    expect(created.share.host).toMatch(/^alpha-web-[0-9a-f]{4}\.share\.dev\.example\.com$/)
  })

  it('shows the password exactly once, and stores only its hash', async () => {
    const { config, snapshot, container } = await world(PUBLIC)
    const created = await createShare(config, snapshot, container('a-web'), { mode: 'protected' })

    expect(created.password).toMatch(/^[23456789A-HJ-NP-Z-]+$/)
    const yaml = readFileSync(join(dir, 'portta-shares.yaml'), 'utf8')
    expect(yaml).not.toContain(created.password!)
    expect(yaml).not.toMatch(/\$(?:apr1|portta)\$/)
    const protection = readProtectionStore(config.authStore).protections[0]
    expect(protection?.hash).toMatch(/^\$portta\$scrypt\$/)
    // And never again, from anywhere.
    expect(JSON.stringify(listShares(config, snapshot))).not.toContain(created.password!)
  })

  it('gives a public share a router and no middleware at all', async () => {
    const { config, snapshot, container } = await world(PUBLIC)
    await createShare(config, snapshot, container('a-web'), { mode: 'public' })
    const yaml = readFileSync(join(dir, 'portta-shares.yaml'), 'utf8')
    expect(yaml).toContain('entryPoints: [websecure]')
    expect(yaml).not.toContain('basicAuth')
  })

  it('revoking deletes a block and leaves the project untouched', async () => {
    const { config, snapshot, container } = await world(PUBLIC)
    const created = await createShare(config, snapshot, container('a-web'), { mode: 'protected' })
    revokeShare(config, created.share.id)

    expect(loadShares(config)).toEqual([])
    // Comments only: `http: {}` is invalid to Traefik and would abort the
    // whole directory, taking every other generated router with it.
    const emptied = readFileSync(join(dir, 'portta-shares.yaml'), 'utf8')
    expect(emptied).not.toMatch(/^http:/m)
    expect(emptied).toContain('not a deny rule')
  })

  it('round-trips its own state through the file', () => {
    const shares = parseShares(
      renderShares([
        {
          id: 'a7f3',
          project: 'p',
          service: 's',
          container: 'p-s-1',
          port: 3000,
          host: 'p-s-a7f3.share.example.com',
          mode: 'public',
          user: null,
          hash: null,
          entryPoint: 'web',
          createdAt: 1,
          expiresAt: 2,
        },
      ]),
    )
    expect(shares).toHaveLength(1)
    expect(shares[0]?.container).toBe('p-s-1')
  })

  it('reads an empty file, a missing one and a mangled one as no shares', () => {
    expect(parseShares(null)).toEqual([])
    expect(parseShares('http: {}\n')).toEqual([])
    expect(parseShares('# portta-shares: not json\n')).toEqual([])
  })
})

describe('the refusals, which are refusals and not warnings', () => {
  it('refuses a datastore outright', async () => {
    const { config, snapshot, container } = await world(PUBLIC)
    await expect(createShare(config, snapshot, container('a-postgres'), { mode: 'protected' })).rejects.toThrow(
      ShareRefused,
    )
  })

  it('refuses a service that never joined the shared network', async () => {
    const { config, snapshot, container } = await world(PUBLIC)
    await expect(createShare(config, snapshot, container('ext-pg'), { mode: 'public' })).rejects.toThrow(
      /not on the portta network|not an HTTP service/,
    )
  })

  it('refuses public without PUBLIC_ENABLED', async () => {
    const { config, snapshot, container } = await world({ ...PUBLIC, publicEnabled: false })
    await expect(createShare(config, snapshot, container('a-web'), { mode: 'public' })).rejects.toThrow(
      /PUBLIC_ENABLED/,
    )
  })

  it('refuses public without PUBLIC_DOMAIN', async () => {
    const { config, snapshot, container } = await world({ ...PUBLIC, publicDomain: null })
    await expect(createShare(config, snapshot, container('a-web'), { mode: 'public' })).rejects.toThrow(
      /PUBLIC_DOMAIN/,
    )
  })

  it('refuses a password over plaintext HTTP on a remote profile', async () => {
    const { config, snapshot, container } = await world({ ...PUBLIC, tlsEnabled: false })
    await expect(createShare(config, snapshot, container('a-web'), { mode: 'protected' })).rejects.toThrow(
      /not protection/,
    )
  })

  it('allows a protected share without TLS locally, where nothing leaves the machine', async () => {
    const { config, snapshot, container } = await world({ profile: 'local', tlsEnabled: false })
    await expect(createShare(config, snapshot, container('a-web'), { mode: 'protected' })).resolves.toBeDefined()
  })

  it('refuses an expiry outside the allowed window, and one is always required', async () => {
    const { config, snapshot, container } = await world(PUBLIC)
    await expect(
      createShare(config, snapshot, container('a-web'), { mode: 'public', ttlSeconds: 5 }),
    ).rejects.toThrow(/expiry/)
    await expect(
      createShare(config, snapshot, container('a-web'), { mode: 'public', ttlSeconds: 999_999_999 }),
    ).rejects.toThrow(/expiry/)
  })

  it('refuses a second share for the same container', async () => {
    const { config, snapshot, container } = await world(PUBLIC)
    await createShare(config, snapshot, container('a-web'), { mode: 'public' })
    await expect(createShare(config, snapshot, container('a-web'), { mode: 'public' })).rejects.toThrow(
      /already shared/,
    )
  })
})

describe('a share that outlives its reason', () => {
  it('expires on its own, and gc removes it', async () => {
    const { config, snapshot, container } = await world(PUBLIC)
    const now = Math.floor(Date.now() / 1000)
    await createShare(config, snapshot, container('a-web'), { mode: 'public', ttlSeconds: 3600 }, now)

    expect(listShares(config, snapshot, now)[0]?.state).toBe('active')
    expect(listShares(config, snapshot, now + 7200)[0]?.state).toBe('expired')
    expect(collectExpired(config, now + 7200)).toBe(1)
    expect(loadShares(config)).toEqual([])
  })

  it('is flagged when the container it names is gone', async () => {
    const { config, snapshot, container } = await world(PUBLIC)
    await createShare(config, snapshot, container('a-web'), { mode: 'public' })

    const { client } = fakeDocker({ containers: GATEWAY })
    const without = await buildSnapshot(client, config)
    expect(listShares(config, without)[0]?.state).toBe('dangling')
  })

  it('is on the Overview, so it is seen without being looked for', async () => {
    const { config, snapshot, container } = await world(PUBLIC)
    await createShare(config, snapshot, container('a-web'), { mode: 'public', ttlSeconds: 60 })

    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, { dynamicDir: dir, ...PUBLIC })
    const overview = (await (await app.request('/api/status')).json()) as {
      counts: { shares: number }
    }
    expect(overview.counts.shares).toBe(1)
  })
})

describe('the API', () => {
  it('creates, lists, regenerates and revokes', async () => {
    const { app } = makeApp({ containers: FULL_HOST }, { dynamicDir: dir, ...PUBLIC })

    const created = (await (
      await post(app, '/api/services/a-web/share', { mode: 'protected', ttlSeconds: 3600 })
    ).json()) as { share: { id: string }; password: string }
    expect(created.password).toBeTruthy()

    const view = (await (await app.request('/api/shares')).json()) as ShareView
    expect(view.shares).toHaveLength(1)
    expect(view.domain).toBe('share.dev.example.com')
    // The listing never carries the password, only the user.
    expect(JSON.stringify(view)).not.toContain(created.password)

    const again = (await (await post(app, `/api/shares/${created.share.id}/regenerate`)).json()) as {
      password: string
    }
    expect(again.password).not.toBe(created.password)

    expect((await del(app, `/api/shares/${created.share.id}`)).status).toBe(200)
    expect(((await (await app.request('/api/shares')).json()) as ShareView).shares).toHaveLength(0)
  })

  it('answers 400 with a hint when it refuses', async () => {
    const { app } = makeApp({ containers: FULL_HOST }, { dynamicDir: dir, ...PUBLIC })
    const response = await post(app, '/api/services/a-postgres/share', { mode: 'protected' })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { hint: string }).hint).toContain('access open')
  })

  it('refuses every share endpoint in read-only mode', async () => {
    const { app } = makeApp({ containers: FULL_HOST }, { dynamicDir: dir, readOnly: true, ...PUBLIC })
    expect((await post(app, '/api/services/a-web/share', { mode: 'public' })).status).toBe(403)
    expect((await del(app, '/api/shares/abcd')).status).toBe(403)
  })
})

describe('the port Traefik dials', () => {
  it('prefers the port the project already told Traefik about', async () => {
    const { config, snapshot } = await world(PUBLIC)
    // A base image exposing 80 in front of an application on 3000 is the
    // common case, and picking the exposed port makes a share that looks
    // perfectly configured answer 502.
    const container = {
      ...(snapshot.containers.find((entry) => entry.id === 'a-web') as ContainerSummary),
      exposedPorts: [80],
      labels: { 'traefik.http.services.alpha-web.loadbalancer.server.port': '3000' },
    }
    expect(backendPort(container)).toBe(3000)

    await createShare(config, snapshot, container, { mode: 'public' })
    expect(readFileSync(join(dir, 'portta-shares.yaml'), 'utf8')).toContain(
      'url: "http://alpha-web-1:3000"',
    )
  })

  it('falls back to the exposed port when the project named none', async () => {
    const { snapshot } = await world()
    const container = snapshot.containers.find((entry) => entry.id === 'a-web') as ContainerSummary
    expect(backendPort(container)).toBe(80)
  })

  it('ignores a port label that is not a port', async () => {
    const { snapshot } = await world()
    const container = {
      ...(snapshot.containers.find((entry) => entry.id === 'a-web') as ContainerSummary),
      labels: { 'traefik.http.services.x.loadbalancer.server.port': 'auto' },
    }
    expect(backendPort(container)).toBe(80)
  })
})
