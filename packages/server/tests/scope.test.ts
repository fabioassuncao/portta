// A permission says what somebody may do. A membership says where.
//
// The negatives are the point: a developer holding `task:write` still gets 403
// in a Project nobody put them in, and every listing answers with theirs rather
// than refusing. What is asserted here per resource is that the second half of
// the decision is actually made — a route that resolved the resource and then
// forgot to ask is exactly what this catches.

import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import {
  environments as environmentsTable,
  projectEnvironments,
  projects as projectsTable,
  tasks as tasksTable,
  users as usersTable,
  type Db,
} from 'portta-db'
import { bootstrapOwner, createAuth, hasOwner, resolveSecurityMode } from 'portta-auth-core'
import { makeProtectedApp, seededDatabase, signInAs, type SeededDatabase } from './helpers.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'

const PASSWORD = 'a-long-enough-password'

let seeded: SeededDatabase
let panel: ReturnType<typeof makeProtectedApp>
let app: Hono
let db: Db
const cookies: Record<string, Record<string, string>> = {}
const ids = { mine: 0, theirs: 0, myTask: '', theirTask: '', developer: '' }

const json = (response: Response) => response.json() as Promise<Record<string, any>>

function get(path: string, as: string) {
  return app.request(path, { headers: cookies[as] })
}

function send(method: string, path: string, as: string, body?: unknown) {
  return app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...cookies[as] },
  })
}

beforeAll(async () => {
  seeded = await seededDatabase()
  // A host with both environments running, so the environment routes have
  // something to answer about rather than 404ing before the scope is reached.
  panel = makeProtectedApp(seeded.database, {}, {
    containers: [
      ...GATEWAY,
      ...PROJECT_A,
      {
        id: 'b-web', name: 'beta-web-1', image: 'nginx:1.31.4-alpine', health: 'healthy',
        networks: ['portta', 'beta_default'], exposed: [80],
        labels: {
          'com.docker.compose.project': 'beta',
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.working_dir': '/srv/dev/beta',
          'traefik.enable': 'true',
        },
      },
      {
        id: 'o-web', name: 'orphan-web-1', image: 'nginx:1.31.4-alpine', health: 'healthy',
        networks: ['orphan_default'], exposed: [80],
        labels: {
          'com.docker.compose.project': 'orphan',
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.working_dir': '/srv/dev/orphan',
        },
      },
    ],
  })
  app = panel.app
  db = panel.db

  const security = resolveSecurityMode({
    PORTTA_AUTH_MODE: 'required',
    PORTTA_AUTH_SECRET: 'a-test-secret-that-is-long-enough',
  })
  await bootstrapOwner(
    (handle) => createAuth({ db: handle, security, hasOwner: () => hasOwner(handle) }),
    db,
    { name: 'Ada', email: 'owner@example.test', password: PASSWORD },
    new Headers(),
  )
  cookies.owner = await signInAs(panel.auth, 'owner@example.test', PASSWORD)

  // Two Projects: one the developer is a member of, one they are not. The
  // seeded 'produto' is theirs; a second one is not.
  ids.mine = Number(seeded.ids.project)
  const [other] = await db
    .insert(projectsTable)
    .values({ slug: 'outro', name: 'Outro' })
    .returning({ id: projectsTable.id })
  ids.theirs = other!.id

  // One environment each, adopted, so the environment routes have both cases.
  const [beta] = await db
    .insert(environmentsTable)
    .values({ composeProject: 'beta' })
    .returning({ id: environmentsTable.id })
  await db.insert(projectEnvironments).values([
    { projectId: ids.mine, environmentId: Number(seeded.ids.environment), source: 'manual' },
    { projectId: ids.theirs, environmentId: beta!.id, source: 'manual' },
  ])

  const [mine] = await db
    .insert(tasksTable)
    .values({ projectId: ids.mine, title: 'Mine', createdBy: 'ada' })
    .returning({ id: tasksTable.id })
  const [theirs] = await db
    .insert(tasksTable)
    .values({ projectId: ids.theirs, title: 'Theirs', createdBy: 'ada' })
    .returning({ id: tasksTable.id })
  ids.myTask = String(mine!.id)
  ids.theirTask = String(theirs!.id)

  const created = await json(await send('POST', '/api/users', 'owner', {
    name: 'Grace', email: 'dev@example.test', password: PASSWORD, role: 'developer',
  }))
  ids.developer = created.id
  await send('PUT', `/api/users/${created.id}/projects`, 'owner', { projects: [ids.mine] })
  cookies.dev = await signInAs(panel.auth, 'dev@example.test', PASSWORD)
})

describe('a named resource in a Project somebody is not in', () => {
  it('is refused, one resource at a time', async () => {
    const refusals: [string, string][] = [
      ['GET', '/api/projects/outro'],
      ['GET', '/api/projects/outro/repositories'],
      ['GET', '/api/projects/outro/activity'],
      ['GET', '/api/projects/outro/tasks'],
      ['GET', '/api/projects/outro/sessions'],
      ['GET', '/api/projects/outro/issues'],
      ['GET', '/api/projects/outro/context'],
      ['GET', '/api/environments/beta'],
      ['GET', '/api/environments/beta/logs'],
      ['GET', '/api/environments/beta/settings'],
      ['GET', '/api/environments/beta/services'],
    ]
    for (const [method, path] of refusals) {
      const response = await app.request(path, { method, headers: cookies.dev })
      expect(response.status, `${method} ${path}`).toBe(403)
    }
  })

  it('is refused for a task in it, by id, however the task is addressed', async () => {
    expect((await get(`/api/tasks/${ids.theirTask}`, 'dev')).status).toBe(403)
    expect((await get(`/api/tasks/${ids.theirTask}/subtasks`, 'dev')).status).toBe(403)
    expect((await get(`/api/tasks/${ids.theirTask}/activity`, 'dev')).status).toBe(403)
    expect((await send('PATCH', `/api/tasks/${ids.theirTask}`, 'dev', { title: 'no' })).status).toBe(403)
    expect((await send('DELETE', `/api/tasks/${ids.theirTask}`, 'dev')).status).toBe(403)
  })

  it('is allowed in the Project they are in', async () => {
    expect((await get('/api/projects/produto', 'dev')).status).toBe(200)
    expect((await get(`/api/tasks/${ids.myTask}`, 'dev')).status).toBe(200)
    expect((await get('/api/environments/alpha/settings', 'dev')).status).toBe(200)
  })

  // An environment nothing adopted has no membership to check, so it belongs to
  // whoever sees everything and to nobody else.
  it('refuses an unadopted environment to a developer, and answers the owner', async () => {
    expect((await get('/api/environments/orphan/settings', 'dev')).status).toBe(403)
    expect((await get('/api/environments/orphan/settings', 'owner')).status).toBe(200)
  })
})

describe('a listing', () => {
  it('answers with theirs rather than refusing', async () => {
    const projects = await json(await get('/api/projects', 'dev'))
    expect(projects.projects.map((project: { slug: string }) => project.slug)).toEqual(['produto'])

    const tasks = await json(await get('/api/tasks', 'dev'))
    expect(tasks.tasks.map((task: { title: string }) => task.title)).toEqual(['Mine'])
  })

  it('shows the owner everything', async () => {
    const projects = await json(await get('/api/projects', 'owner'))
    expect(projects.projects.map((project: { slug: string }) => project.slug).sort()).toEqual(['outro', 'produto'])
  })

  it('sums only the visible on the Overview', async () => {
    const overview = await json(await get('/api/overview', 'dev'))
    expect(overview.projects.map((project: { slug: string }) => project.slug)).toEqual(['produto'])
  })
})

describe('losing a membership', () => {
  it('closes the door on the next request, with no sign-in in between', async () => {
    expect((await get('/api/projects/produto', 'dev')).status).toBe(200)
    await send('PUT', `/api/users/${ids.developer}/projects`, 'owner', { projects: [] })
    expect((await get('/api/projects/produto', 'dev')).status).toBe(403)
    await send('PUT', `/api/users/${ids.developer}/projects`, 'owner', { projects: [ids.mine] })
  })
})

describe('what /api/auth/me says', () => {
  it('names the Projects this request can open', async () => {
    const me = await json(await get('/api/auth/me', 'dev'))
    expect(me).toMatchObject({ role: 'developer' })
    expect(me.projects.map((project: { slug: string }) => project.slug)).toEqual(['produto'])
    expect(me.scope).toEqual([ids.mine])

    const owner = await json(await get('/api/auth/me', 'owner'))
    expect(owner.scope).toBe('all')
    expect(owner.projects).toHaveLength(2)
  })
})

describe('the owner of a row is not the owner of the panel', () => {
  it('leaves a banned developer with nothing, membership or not', async () => {
    await db.update(usersTable).set({ banned: true }).where(eq(usersTable.id, ids.developer))
    expect((await get('/api/projects/produto', 'dev')).status).toBe(401)
    await db.update(usersTable).set({ banned: false }).where(eq(usersTable.id, ids.developer))
    cookies.dev = await signInAs(panel.auth, 'dev@example.test', PASSWORD)
  })
})

// The coverage check: every documented read whose path names a Project or an
// environment, driven at a Project this caller is not in. A route that resolves
// its resource and forgets to ask about the scope answers 200 here, and this is
// the only thing that would notice.
describe('every documented read that names a Project', () => {
  const FILL: Record<string, string> = {
    '{slug}': 'outro',
    '{project}': 'beta',
    '{service}': 'web',
    '{ref}': '',
  }

  it('is refused to somebody who is not in it', async () => {
    const document = JSON.parse(
      readFileSync(new URL(import.meta.resolve('portta-contracts/openapi.json')), 'utf8'),
    ) as { paths: Record<string, Record<string, unknown>> }

    FILL['{ref}'] = ids.theirTask
    const checked: string[] = []
    for (const [path, item] of Object.entries(document.paths)) {
      if (!('get' in item)) continue
      // Only the paths that name one: a global read has no scope to narrow.
      if (!path.includes('{slug}') && !path.includes('{project}') && !path.includes('{ref}')) continue
      // `{id}` is a container or a share on this fixture, addressed by an id
      // this suite does not mint. Those have their own assertions above.
      if (path.includes('{id}')) continue

      let filled = path
      for (const [token, value] of Object.entries(FILL)) filled = filled.replaceAll(token, value)
      if (filled.includes('{')) continue

      const response = await get(`/api${filled}`, 'dev')
      checked.push(`${filled} -> ${response.status}`)
      expect(response.status, `GET /api${filled}`).toBe(403)
    }

    // A guard on the guard: an empty sweep would pass silently.
    expect(checked.length, checked.join('\n')).toBeGreaterThan(8)
  })
})
