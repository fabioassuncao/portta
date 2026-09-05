// The development surfaces: consolidated services, the context, attributed
// resources and the dashboard. The presenters are tested on their own; what is
// asserted here is that the routes feed them from the right places and stay
// honest without a database.

import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { projectEnvironments, projects as projectsTable, repositories as repositoriesTable } from 'portta-db'
import type { Database } from '../src/db/index.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { makeApp, post, seededDatabase, type SeededDatabase } from './helpers.ts'

const open: SeededDatabase[] = []
afterEach(async () => {
  for (const seeded of open.splice(0)) await seeded.close()
})

/**
 * A Project with a description, two tasks in flight, and the environment it
 * adopted — the situation the development surfaces exist to summarise.
 */
async function work(): Promise<Database> {
  const seeded = await seededDatabase()
  open.push(seeded)
  const projectId = Number(seeded.ids.project)

  await seeded.db.update(projectsTable).set({ description: 'The product' }).where(eq(projectsTable.id, projectId))
  // These surfaces are about tasks and environments, not code: the seeded
  // repository would add a row every assertion here would have to ignore.
  await seeded.db.delete(repositoriesTable).where(eq(repositoriesTable.projectId, projectId))
  await seeded.db.insert(projectEnvironments).values({
    projectId, environmentId: Number(seeded.ids.environment), source: 'manual',
  })
  await seeded.database.tasks.create(seeded.ids.project, { title: 'Fix auth', status: 'in_progress', assignee: 'claude' }, null)
  await seeded.database.tasks.create(seeded.ids.project, { title: 'Write docs', status: 'ready', priority: 'high' }, null)

  return seeded.database
}

describe('consolidated services', () => {
  it('folds every service of an environment into one row each', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const response = await app.request('/api/environments/alpha/services')
    expect(response.status).toBe(200)
    const body = await response.json() as { environment: string; services: Array<{ name: string; access: { kind: string; primary: { url: string } | null }; actions: { stop: boolean } }> }
    expect(body.environment).toBe('alpha')
    const web = body.services.find((service) => service.name === 'web')
    expect(web?.access.kind).toBe('http')
    expect(web?.access.primary?.url).toContain('alpha-web')
    expect(web?.actions.stop).toBe(true)
    expect(body.services.some((service) => service.access.kind === 'tcp')).toBe(true)
  })

  it('answers 404 for an environment that is not running', async () => {
    const { app } = makeApp({ containers: [...GATEWAY] })
    expect((await app.request('/api/environments/ghost/services')).status).toBe(404)
  })

  it('runs an action on one service by name and refuses an unknown verb', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const ok = await post(app, '/api/environments/alpha/services/web/actions/restart')
    expect(ok.status).toBe(200)
    expect(docker.calls.some((call) => call.method.toLowerCase().includes('restart'))).toBe(true)
    expect((await post(app, '/api/environments/alpha/services/web/actions/explode')).status).toBe(400)
    expect((await post(app, '/api/environments/alpha/services/nope/actions/start')).status).toBe(404)
  })
})

describe('the development dashboard', () => {
  it('answers without a database, with empty work', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const response = await app.request('/api/overview')
    expect(response.status).toBe(200)
    const body = await response.json() as { work: { counts: { open: number } }; projects: unknown[]; runtime: { environmentsRunning: number }; gateway: { up: boolean } }
    expect(body.work.counts.open).toBe(0)
    expect(body.projects).toEqual([])
    expect(body.runtime.environmentsRunning).toBeGreaterThan(0)
    expect(body.gateway.up).toBe(true)
  })

  it('counts the work and summarises the projects when there is one', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, await work())
    const body = await (await app.request('/api/overview')).json() as { work: { counts: { open: number; inProgress: number }; inProgress: Array<{ title: string }> }; projects: Array<{ slug: string; openTasks: number; runningEnvironments: number }> }
    expect(body.work.counts).toMatchObject({ open: 2, inProgress: 1 })
    expect(body.work.inProgress[0]?.title).toBe('Fix auth')
    expect(body.projects[0]).toMatchObject({ slug: 'produto', openTasks: 2, runningEnvironments: 1 })
  })
})

describe('the development context and resources', () => {
  it('needs a database, and a project that exists', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    expect((await app.request('/api/projects/produto/context')).status).toBe(503)
    const withDb = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, await work())
    expect((await withDb.app.request('/api/projects/nope/context')).status).toBe(404)
  })

  it('hands an agent the project, its environments with services, the next task and the platform rules', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, await work())
    const response = await app.request('/api/projects/produto/context', { headers: { 'X-Portta-Actor': 'claude' } })
    expect(response.status).toBe(200)
    const body = await response.json() as { actor: string; project: { slug: string }; work: { next: { title: string } | null; inProgress: unknown[] }; environments: Array<{ name: string; services: unknown[]; startCommand: string }>; instructions: { platform: string }; commands: Record<string, string> }
    expect(body.actor).toBe('claude')
    expect(body.project.slug).toBe('produto')
    expect(body.work.next?.title).toBe('Write docs')
    expect(body.work.inProgress).toHaveLength(1)
    expect(body.environments[0]).toMatchObject({ name: 'alpha', startCommand: 'portta envs start alpha' })
    expect(body.environments[0]?.services.length).toBeGreaterThan(0)
    expect(body.instructions.platform).toContain('Never')
    expect(body.commands['nextTask']).toBe('portta tasks next --project produto')
  })

  it('attributes resources through adopted environments', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, await work())
    const body = await (await app.request('/api/projects/produto/resources')).json() as { project: string; environments: unknown[]; collectorActive: boolean }
    expect(body.project).toBe('produto')
    expect(body.collectorActive).toBe(false)
    expect(body.environments).toEqual([])
  })
})
