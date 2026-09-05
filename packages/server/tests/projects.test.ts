import { describe, expect, it } from 'vitest'
import { del, makeApp, post } from './helpers.ts'
import { GATEWAY, PROJECT_A, PROJECT_B } from './fixtures.ts'
import {
  repositoryCoordinate,
  resolveAdoption,
  type ProjectCoordinates,
} from '../src/services/adoption.ts'
import type { Database } from '../src/db/index.ts'
import type { Project } from 'portta-contracts'

describe('repository coordinates', () => {
  it('reads the same slug out of every remote shape', () => {
    expect(repositoryCoordinate('git@github.com:Acme/Alpha.git')).toBe('acme/alpha')
    expect(repositoryCoordinate('https://github.com/acme/alpha')).toBe('acme/alpha')
    expect(repositoryCoordinate('https://github.com/acme/alpha.git')).toBe('acme/alpha')
    expect(repositoryCoordinate(null)).toBeNull()
  })
})

const PROJECTS: ProjectCoordinates[] = [
  { id: '1', slug: 'meu-produto', repositories: ['acme/alpha', 'acme/api'] },
  { id: '2', slug: 'outro', repositories: ['acme/beta'] },
]

describe('adoption precedence', () => {
  const project = { name: 'alpha', group: null, repo: null, repoUrl: null }

  it('adopts nothing when there is nothing to go on', () => {
    expect(resolveAdoption(project, PROJECTS, new Map())).toBeNull()
  })

  it('honours the portta.project label the project declared', () => {
    expect(resolveAdoption({ ...project, group: 'meu-produto' }, PROJECTS, new Map())).toEqual({
      projectId: '1',
      source: 'label',
    })
  })

  it('lets a manual mapping override the label', () => {
    expect(
      resolveAdoption({ ...project, group: 'meu-produto' }, PROJECTS, new Map([['alpha', '2']])),
    ).toEqual({ projectId: '2', source: 'manual' })
  })

  it('matches on the repository when exactly one Project owns it', () => {
    expect(
      resolveAdoption(
        { ...project, repoUrl: 'git@github.com:acme/alpha.git' },
        PROJECTS,
        new Map(),
      ),
    ).toEqual({ projectId: '1', source: 'repo-match' })
  })

  it('adopts by path: the scan says which repository the environment runs from', () => {
    const projects: ProjectCoordinates[] = [
      { id: '1', slug: 'one', repositories: [], scanKeys: ['abcdef012345'], paths: ['/srv/projects/one'] },
      { id: '2', slug: 'two', repositories: [], scanKeys: [], paths: ['/srv/projects/two'] },
    ]
    expect(resolveAdoption(project, projects, new Map(), { environmentKeys: { alpha: 'abcdef012345' } })).toEqual({ projectId: '1', source: 'path' })
    expect(resolveAdoption({ ...project, workingDir: '/srv/projects/two/deploy' }, projects, new Map())).toEqual({ projectId: '2', source: 'path' })
    expect(resolveAdoption({ ...project, workingDir: '/srv/projects/twofold' }, projects, new Map())).toBeNull()
  })

  it('adopts nothing when two Projects own the same repository', () => {
    const ambiguous: ProjectCoordinates[] = [
      { id: '1', slug: 'one', repositories: ['acme/alpha'] },
      { id: '2', slug: 'two', repositories: ['acme/alpha'] },
    ]
    expect(
      resolveAdoption({ ...project, repoUrl: 'https://github.com/acme/alpha' }, ambiguous, new Map()),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The endpoints
// ---------------------------------------------------------------------------

interface Store {
  projects: Map<string, { id: string; slug: string; name: string; description: string | null; archived: boolean; relativePath: string | null }>
  repositories: Map<string, Record<string, unknown>>
  environments: Map<string, string[]>
  granted: Set<string>
  /** Set by the test to prove nothing else was touched. */
  destructiveCalls: string[]
}

function projectDatabase(granted: string[] = ['acme/alpha', 'acme/api']): { db: Database; store: Store } {
  const store: Store = {
    projects: new Map(),
    repositories: new Map(),
    environments: new Map(),
    granted: new Set(granted),
    destructiveCalls: [],
  }
  let nextId = 1

  let nextRepositoryId = 1
  const grantedRepo = (fullName: string) => ({ id: `repo-${fullName}`, fullName, name: fullName.split('/')[1], htmlUrl: `https://github.com/${fullName}`, defaultBranch: 'main', private: true, archived: false })
  const withGitHub = (row: Record<string, unknown>) => {
    const id = row['githubRepositoryId'] as string | null
    const fullName = id ? id.replace('repo-', '') : null
    return { ...row, github: fullName ? { repositoryId: id, fullName, htmlUrl: `https://github.com/${fullName}`, defaultBranch: 'main', private: true, archived: false } : null }
  }
  const db = {
    status: () => ({ configured: true, available: true, reason: null, checkedAt: 0, migrations: [] }),
    environments: { find: async () => null, upsertSeen: async () => ({}), list: async () => [] },
    settings: { listAllEnvironment: async () => [], listAllService: async () => [] },
    repositories: {
      list: async (projectId?: string) =>
        [...store.repositories.values()].filter((row) => projectId === undefined || row['projectId'] === projectId).map(withGitHub),
      find: async (id: string) => (store.repositories.has(id) ? withGitHub(store.repositories.get(id)!) : null),
      findByGitHub: async (githubId: string) => {
        const row = [...store.repositories.values()].find((entry) => entry['githubRepositoryId'] === githubId)
        return row ? withGitHub(row) : null
      },
      create: async (projectId: string, input: Record<string, unknown>) => {
        const id = String(nextRepositoryId++)
        const row = { id, projectId, role: null, localPath: null, relativePath: null, remoteUrl: null, provider: input['githubRepositoryId'] ? 'github' : 'local', position: 0, ...input }
        store.repositories.set(id, row)
        return withGitHub(row)
      },
      update: async (id: string, patch: Record<string, unknown>) => {
        const row = store.repositories.get(id)
        if (!row) return null
        const updated = { ...row, ...patch }
        store.repositories.set(id, updated)
        return withGitHub(updated)
      },
      remove: async (id: string) => store.repositories.delete(id),
    },
    github: {
      findRepository: async (fullName: string) => (store.granted.has(fullName) ? grantedRepo(fullName) : null),
      listRepositories: async () => [...store.granted].map(grantedRepo),
      listIssues: async () => [],
      listIssueEnvironments: async () => [],
      listRelationships: async () => [],
    },
    projects: {
      create: async (input: { slug: string; name: string; description: string | null; relativePath: string | null }) => {
        const record = { id: String(nextId++), archived: false, ...input }
        store.projects.set(input.slug, record)
        return record
      },
      update: async (slug: string, patch: Record<string, unknown>) => {
        const record = store.projects.get(slug)
        if (!record) return null
        const updated = { ...record, ...patch }
        store.projects.set(slug, updated)
        return updated
      },
      list: async () => [...store.projects.values()],
      find: async (slug: string) => store.projects.get(slug) ?? null,
      remove: async (slug: string) => {
        store.destructiveCalls.push(`project:${slug}`)
        return store.projects.delete(slug)
      },
      listEnvironments: async () =>
        [...store.environments.entries()].flatMap(([projectId, environments]) =>
          environments.map((composeProject) => ({ projectId, composeProject, source: 'manual' })),
        ),
      setEnvironments: async (projectId: string, environments: string[]) =>
        void store.environments.set(projectId, environments),
    },
  }
  return { db: db as unknown as Database, store }
}

function app(granted?: string[]) {
  const { db, store } = projectDatabase(granted)
  return { ...makeApp({ containers: [...GATEWAY, ...PROJECT_A, ...PROJECT_B] }, {}, db), store }
}

async function put(instance: ReturnType<typeof app>, path: string, body: unknown) {
  return instance.app.request(path, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}

describe('GET/POST /api/projects', () => {
  it('creates a Project that is visible with nothing running', async () => {
    const instance = app()
    const created = await post(instance.app, '/api/projects', {
      slug: 'meu-produto',
      name: 'Meu Produto',
      description: 'The thing we sell',
    })
    expect(created.status).toBe(201)

    const list = await (await instance.app.request('/api/projects')).json()
    expect(list.projects).toEqual([
      expect.objectContaining({
        slug: 'meu-produto',
        name: 'Meu Produto',
        repositoryCount: 0,
        environmentCount: 0,
        runningEnvironmentCount: 0,
      }),
    ])
  })

  it('refuses a duplicate slug rather than silently reusing one', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'meu-produto', name: 'One' })
    const second = await post(instance.app, '/api/projects', { slug: 'meu-produto', name: 'Two' })
    expect(second.status).toBe(409)
  })

  it('answers 503 with a hint when persistence is unavailable', async () => {
    const { app: bare } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const response = await bare.request('/api/projects')
    expect(response.status).toBe(503)
    expect((await response.json()).hint).toContain('Docker-backed pages remain available')
  })
})

describe('placing a Project under Projects Home', () => {
  it('stores a first-level directory name and reports it as managed', async () => {
    const instance = app()
    const created = await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto', relativePath: 'produto' })
    expect(created.status).toBe(201)
    expect(((await created.json()) as Project).location).toBe('managed')
  })

  it('refuses an absolute path, a parent reference or a nested path', async () => {
    const instance = app()
    for (const relativePath of ['/srv/projects/produto', '../produto', 'a/b']) {
      const response = await post(instance.app, '/api/projects', { slug: `p-${relativePath.length}`, name: 'P', relativePath })
      expect(response.status, relativePath).toBe(400)
    }
  })
})

describe('the deprecated aliases', () => {
  it('are gone: /api/workspaces is a 404, not a second name', async () => {
    const instance = app()
    expect((await instance.app.request('/api/workspaces')).status).toBe(404)
    expect((await post(instance.app, '/api/workspaces', { slug: 'x', name: 'X' })).status).toBe(404)
  })
})

describe('repositories', () => {
  it('registers a GitHub repository by name, which is the monorepo case', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'mono', name: 'Mono' })
    const response = await post(instance.app, '/api/projects/mono/repositories', { githubFullName: 'acme/alpha', role: 'other' })
    expect(response.status).toBe(201)
    const project = (await (await instance.app.request('/api/projects/mono')).json()) as Project
    expect(project.repositories).toHaveLength(1)
    expect(project.repositories[0]).toMatchObject({ name: 'alpha', provider: 'github', role: 'other' })
    expect(project.githubRepositories.map((entry) => entry.fullName)).toEqual(['acme/alpha'])
  })

  it('registers a local repository with no GitHub at all', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'local', name: 'Local' })
    const response = await post(instance.app, '/api/projects/local/repositories', { name: 'api', localPath: '/srv/projects/local/api' })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({ name: 'api', provider: 'local', localPath: '/srv/projects/local/api', github: null, git: null })
    const list = await (await instance.app.request('/api/projects')).json()
    expect(list.projects[0].repositoryCount).toBe(1)
  })

  it('gives one GitHub repository to one Project', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'one', name: 'One' })
    await post(instance.app, '/api/projects', { slug: 'two', name: 'Two' })
    expect((await post(instance.app, '/api/projects/one/repositories', { githubFullName: 'acme/alpha' })).status).toBe(201)
    const second = await post(instance.app, '/api/projects/two/repositories', { githubFullName: 'acme/alpha' })
    expect(second.status).toBe(400)
    expect((await second.json()).hint).toContain('belongs to one Project')
  })

  it('refuses a repository outside the installation, and says why', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    const response = await post(instance.app, '/api/projects/produto/repositories', { githubFullName: 'someone/else' })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('not a repository this gateway was granted')
    expect(body.hint).toContain('docs/github.md')
  })

  it('the old PUT is gone', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    expect((await put(instance, '/api/projects/produto/repositories', { repositories: [] })).status).toBe(404)
  })
})

describe('adopting environments', () => {
  it('adopts by hand, and says the mapping was manual', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/projects/produto/environments', {
      environments: ['alpha'],
    })
    const body = (await response.json()) as Project
    expect(body.environments).toEqual([
      expect.objectContaining({ environment: 'alpha', source: 'manual', running: true }),
    ])
  })

  it('refuses an environment that is not running', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/projects/produto/environments', {
      environments: ['ghost'],
    })
    expect(response.status).toBe(400)
  })
})

describe('deleting a Project', () => {
  it('removes the grouping and nothing else', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    await put(instance, '/api/projects/produto/environments', { environments: ['alpha'] })

    const response = await del(instance.app, '/api/projects/produto')
    expect(response.status).toBe(200)
    expect((await response.json()).note).toContain('no container, volume, environment or repository')

    // Nothing was stopped or removed on the Docker side.
    expect(instance.docker.removed).toEqual([])
    expect(instance.docker.calls.filter((call) => ['stop', 'remove'].includes(call.method))).toEqual([])

    // And the environment is still exactly where it was.
    const runtimes = await (await instance.app.request('/api/environments')).json()
    expect(runtimes.environments.map((environment: { name: string }) => environment.name)).toContain('alpha')
  })

  it('404s a Project that does not exist', async () => {
    const instance = app()
    expect((await del(instance.app, '/api/projects/ghost')).status).toBe(404)
  })
})

describe('the environment endpoints', () => {
  it('never say workspace', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    await put(instance, '/api/projects/produto/environments', { environments: ['alpha'] })

    const runtimes = await (await instance.app.request('/api/environments')).json()
    expect(JSON.stringify(runtimes)).not.toContain('workspace')
  })
})
