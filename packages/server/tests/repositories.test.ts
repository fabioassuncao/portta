import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repositoryKey } from 'portta-core'
import { readRepositoryScan, readScanIndex } from '../src/services/git.ts'
import { discoveredRepositories, loadScans, matchScan, toRepository } from '../src/services/repositories.ts'
import { providerFor } from '../src/db/repositories.ts'
import { del, makeApp, post, testConfig } from './helpers.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import type { Database } from '../src/db/index.ts'
import type { RepositoryRow } from '../src/db/repositories.ts'

const NOW = 1_800_000_000_000
const ROOT = '/srv/projects/alpha'
const KEY = repositoryKey(ROOT)

function scanDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'portta-scan-'))
  writeFileSync(join(dir, 'index.json'), JSON.stringify({
    version: 1,
    collectedAt: NOW / 1000 - 30,
    home: '/srv/projects',
    repositories: [
      { key: KEY, path: ROOT, name: 'alpha', remote: 'git@github.com:acme/alpha.git', location: 'managed', relativePath: 'alpha' },
      { key: repositoryKey('/srv/projects/orphan'), path: '/srv/projects/orphan', name: 'orphan', remote: null, location: 'managed', relativePath: 'orphan' },
      { key: repositoryKey('/srv/projects/workspace/nested'), path: '/srv/projects/workspace/nested', name: 'nested', remote: null, location: 'managed', relativePath: 'workspace/nested' },
    ],
    environments: { alpha: KEY, 'alpha-pr7': KEY },
  }))
  writeFileSync(join(dir, `${KEY}.json`), JSON.stringify({
    version: 1, key: KEY, path: ROOT, name: 'alpha', collectedAt: NOW / 1000 - 40,
    git: {
      branch: 'main', detached: false,
      head: { sha: '9f2c1abfeed1234567890abcdef1234567890abc', shortSha: '9f2c1ab', subject: 'Add totals', author: 'Ada', date: NOW / 1000 - 3600 },
      staged: 1, unstaged: 2, untracked: 0, unmerged: 0, dirty: true, upstream: 'origin/main', ahead: 3, behind: 0,
      remote: 'git@github.com:acme/alpha.git',
    },
    reason: null,
    commits: [
      { sha: '9f2c1abfeed1234567890abcdef1234567890abc', shortSha: '9f2c1ab', subject: 'Add totals', author: 'Ada', email: 'a@x', date: NOW / 1000 - 3600 },
      { sha: 'not a sha' },
    ],
    instructions: [
      { path: 'AGENTS.md', audience: 'any', sizeBytes: 12, modifiedAt: 1, sha256: 'ab', dirty: true, content: '# Rules\n', truncated: false },
      { path: '../etc/passwd', audience: 'any', sizeBytes: 1, modifiedAt: 1, sha256: 'cd', dirty: false, content: 'x', truncated: false },
    ],
    environments: ['alpha', 'alpha-pr7'],
  }))
  return dir
}

function row(overrides: Partial<RepositoryRow> = {}): RepositoryRow {
  return {
    id: '1', projectId: '1', name: 'alpha', role: 'web', localPath: null, relativePath: null, remoteUrl: null,
    provider: 'local', githubRepositoryId: null, position: 0, createdAt: new Date(0), updatedAt: new Date(0), github: null,
    ...overrides,
  }
}

describe('reading a repository scan', () => {
  it('coerces the file and derives links, commits and instructions', () => {
    const config = testConfig({ gitDir: scanDir() })
    const scan = readRepositoryScan(config, KEY, NOW)
    expect(scan.collected).toBe(true)
    expect(scan.git?.branch).toBe('main')
    expect(scan.links.commit).toBe('https://github.com/acme/alpha/commit/9f2c1abfeed1234567890abcdef1234567890abc')
    expect(scan.commits).toHaveLength(1)
    expect(scan.commits[0]?.url).toContain('/commit/9f2c1ab')
    expect(scan.instructions.map((file) => file.path)).toEqual(['AGENTS.md'])
    expect(scan.environments).toEqual(['alpha', 'alpha-pr7'])
    expect(scan.refreshCommand).toBe(`./bin/portta repos scan --path ${ROOT}`)
  })

  it('reports an absent or malformed key as not collected, never as an error', () => {
    const config = testConfig({ gitDir: scanDir() })
    expect(readRepositoryScan(config, 'ffffffffffff', NOW).collected).toBe(false)
    expect(readRepositoryScan(config, '../index', NOW).collected).toBe(false)
  })

  it('reads the index with its repositories', () => {
    const index = readScanIndex(testConfig({ gitDir: scanDir() }))
    expect(index?.repositories.map((entry) => entry.name)).toEqual(['alpha', 'orphan', 'nested'])
    expect(index?.home).toBe('/srv/projects')
  })
})

describe('joining a registered repository with the scan', () => {
  it('matches by local path, then by remote coordinate', () => {
    const config = testConfig({ gitDir: scanDir() })
    const scans = loadScans(config)
    expect(matchScan(row({ localPath: ROOT }), scans.index)?.key).toBe(KEY)
    expect(matchScan(row({ remoteUrl: 'https://github.com/acme/alpha' }), scans.index)?.key).toBe(KEY)
    expect(matchScan(row({ github: { repositoryId: 'r1', fullName: 'Acme/Alpha', htmlUrl: 'x', defaultBranch: null, private: false, archived: false } }), scans.index)?.key).toBe(KEY)
    expect(matchScan(row({ localPath: '/elsewhere' }), scans.index)).toBeNull()
  })

  it('summarises git, counts instructions and lists environments', () => {
    const config = testConfig({ gitDir: scanDir() })
    const repository = toRepository(config, row({ localPath: ROOT }), loadScans(config), NOW)
    expect(repository.git).toMatchObject({ branch: 'main', dirty: true, changed: 3, ahead: 3, stale: false })
    expect(repository.instructionCount).toBe(1)
    expect(repository.environments).toEqual(['alpha', 'alpha-pr7'])
    expect(repository.scanPath).toBe(ROOT)
  })

  it('offers only the scanned roots nobody registered', () => {
    const config = testConfig({ gitDir: scanDir() })
    const discovered = discoveredRepositories([row({ localPath: ROOT })], loadScans(config))
    expect(discovered.map((entry) => entry.name)).toEqual(['orphan', 'nested'])
    expect(discovered[0]).toMatchObject({ location: 'managed', relativePath: 'orphan', environments: [] })
    // A repository inside a workspace directory carries the two-segment path the scan gave it.
    expect(discovered[1]).toMatchObject({ location: 'managed', relativePath: 'workspace/nested', path: '/srv/projects/workspace/nested' })
  })

  it('names the provider from the remote', () => {
    expect(providerFor(null)).toBe('local')
    expect(providerFor('git@github.com:a/b.git')).toBe('github')
    expect(providerFor('https://gitlab.com/a/b')).toBe('gitlab')
    expect(providerFor('https://bitbucket.org/a/b')).toBe('bitbucket')
    expect(providerFor('https://git.example.com/a/b')).toBe('other')
    expect(providerFor(null, true)).toBe('github')
  })
})

// ---------------------------------------------------------------------------
// The endpoints
// ---------------------------------------------------------------------------

function repositoryDatabase() {
  const rows = new Map<string, Record<string, unknown>>()
  let next = 1
  const db = {
    status: () => ({ configured: true, available: true, reason: null, checkedAt: 0, migrations: [] }),
    environments: { find: async () => null, upsertSeen: async () => ({}), list: async () => [] },
    settings: { listAllEnvironment: async () => [], listAllService: async () => [] },
    projects: {
      find: async (slug: string) => (slug === 'produto' ? { id: '1', slug, name: 'Produto', description: null, archived: false, relativePath: 'alpha' } : null),
      list: async () => [{ id: '1', slug: 'produto', name: 'Produto', description: null, archived: false, relativePath: 'alpha' }],
      listEnvironments: async () => [],
    },
    github: { findRepository: async () => null, listRepositories: async () => [], listIssues: async () => [], listIssueEnvironments: async () => [], listRelationships: async () => [] },
    repositories: {
      list: async (projectId?: string) => [...rows.values()].filter((entry) => projectId === undefined || entry['projectId'] === projectId),
      find: async (id: string) => rows.get(id) ?? null,
      findByGitHub: async () => null,
      create: async (projectId: string, input: Record<string, unknown>) => {
        const id = String(next++)
        const created = { id, projectId, role: null, localPath: null, relativePath: null, remoteUrl: null, provider: 'local', githubRepositoryId: null, position: 0, github: null, ...input }
        rows.set(id, created)
        return created
      },
      update: async (id: string, patch: Record<string, unknown>) => {
        const current = rows.get(id)
        if (!current) return null
        const updated = { ...current, ...patch }
        rows.set(id, updated)
        return updated
      },
      remove: async (id: string) => rows.delete(id),
    },
  }
  return { db: db as unknown as Database, rows }
}

function app() {
  const { db, rows } = repositoryDatabase()
  const instance = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, { gitDir: scanDir(), projectsHome: '/srv/projects' }, db)
  return { ...instance, rows }
}

describe('the repository endpoints', () => {
  it('offers what the host scanned, then registers it from its key', async () => {
    const instance = app()
    const discovered = await (await instance.app.request('/api/repositories/discovered')).json()
    expect(discovered.repositories.map((entry: { name: string }) => entry.name)).toEqual(['alpha', 'orphan', 'nested'])

    const created = await post(instance.app, '/api/projects/produto/repositories', { scanKey: KEY, role: 'web' })
    expect(created.status).toBe(201)
    const body = await created.json()
    expect(body).toMatchObject({ name: 'alpha', localPath: ROOT, relativePath: 'alpha', remoteUrl: 'git@github.com:acme/alpha.git', scanKey: KEY, role: 'web' })
    expect(body.git.branch).toBe('main')
    expect(body.environments).toEqual(['alpha', 'alpha-pr7'])

    const after = await (await instance.app.request('/api/repositories/discovered')).json()
    expect(after.repositories.map((entry: { name: string }) => entry.name)).toEqual(['orphan', 'nested'])
  })

  it('serves git, commits, instructions and environments for one repository', async () => {
    const instance = app()
    const created = await (await post(instance.app, '/api/projects/produto/repositories', { scanKey: KEY })).json()
    const git = await (await instance.app.request(`/api/repositories/${created.id}/git`)).json()
    expect(git.git.head.subject).toBe('Add totals')
    const commits = await (await instance.app.request(`/api/repositories/${created.id}/commits`)).json()
    expect(commits.commits).toHaveLength(1)
    const instructions = await (await instance.app.request(`/api/repositories/${created.id}/instructions`)).json()
    expect(instructions.instructions[0]).toMatchObject({ path: 'AGENTS.md', dirty: true, content: '# Rules\n' })
    const environments = await (await instance.app.request(`/api/repositories/${created.id}/environments`)).json()
    expect(environments.environments).toEqual([expect.objectContaining({ environment: 'alpha', running: true })])
  })

  it('adopts the environment through the repository, and says the source was the path', async () => {
    const instance = app()
    await post(instance.app, '/api/projects/produto/repositories', { scanKey: KEY })
    const project = await (await instance.app.request('/api/projects/produto')).json()
    expect(project.environments).toEqual([expect.objectContaining({ environment: 'alpha', source: 'path' })])
  })

  it('refuses a scan key it does not know, and an unregistered repository is a 404', async () => {
    const instance = app()
    const refused = await post(instance.app, '/api/projects/produto/repositories', { scanKey: 'ffffffffffff' })
    expect(refused.status).toBe(400)
    expect((await refused.json()).hint).toContain('portta repos scan')
    expect((await instance.app.request('/api/repositories/99/git')).status).toBe(404)
  })

  it('unregisters without touching anything else, and says so', async () => {
    const instance = app()
    const created = await (await post(instance.app, '/api/projects/produto/repositories', { name: 'api', localPath: '/srv/projects/alpha/api' })).json()
    const response = await del(instance.app, `/api/repositories/${created.id}`)
    expect(response.status).toBe(200)
    expect((await response.json()).note).toContain('the clone, the remote and GitHub were not touched')
    expect(instance.docker.removed).toEqual([])
  })
})
