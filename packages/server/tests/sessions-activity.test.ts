// Sessions and activity: who is working on what, and what happened.

import { afterEach, describe, expect, it } from 'vitest'
import { projectEnvironments, projects as projectsTable } from 'portta-db'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { makeApp, post, seededDatabase, type SeededDatabase } from './helpers.ts'

const open: SeededDatabase[] = []
afterEach(async () => {
  for (const seeded of open.splice(0)) await seeded.close()
})

/** A Project that has adopted `alpha`, and a second Project to be refused from. */
async function work() {
  const seeded = await seededDatabase()
  open.push(seeded)
  await seeded.db.insert(projectEnvironments).values({
    projectId: Number(seeded.ids.project),
    environmentId: Number(seeded.ids.environment),
    source: 'manual',
  })
  const [other] = await seeded.db
    .insert(projectsTable)
    .values({ slug: 'outro', name: 'Outro' })
    .returning({ id: projectsTable.id })

  return {
    db: seeded.database,
    ids: { ...seeded.ids, other: String(other!.id) },
    tasks: seeded.database.tasks,
    activity: seeded.database.activity,
  }
}

const json = (response: Response) => response.json() as Promise<Record<string, any>>

describe('sessions', () => {
  it('starts, heartbeats and ends a session, as the agent that announced itself', async () => {
    const { db, ids, tasks, activity } = await work()
    const task = await tasks.create(ids.project, { title: 'Fix auth' }, null)
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, db)
    const started = await post(app, '/api/projects/produto/sessions', { taskId: task.id, environment: 'alpha', summary: 'auth fix' }, { 'X-Portta-Actor': 'claude-code' })
    expect(started.status).toBe(201)
    const session = await json(started)
    expect(session).toMatchObject({ actor: 'claude-code', actorKind: 'agent', agent: 'claude-code', status: 'active', task: { id: task.id, title: 'Fix auth' }, environment: 'alpha', project: 'produto' })
    expect((await activity.list())[0]).toMatchObject({ kind: 'session.started', sessionId: session.id, taskId: task.id })
    expect((await json(await app.request(`/api/tasks/${task.id}`))).activeSessionCount).toBe(1)

    const beat = await app.request(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ heartbeat: true }), headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', 'X-Portta-Actor': 'claude-code' } })
    expect((await json(beat)).status).toBe('active')

    const denied = await app.request(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ended' }), headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', 'X-Portta-Actor': 'other-bot' } })
    expect(denied.status).toBe(403)

    const ended = await app.request(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ended', summary: 'done' }), headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' } })
    expect(await json(ended)).toMatchObject({ status: 'ended', summary: 'done' })
    expect(ended.status).toBe(200)
    expect((await activity.list())[0]).toMatchObject({ kind: 'session.ended', sessionId: session.id })
    expect((await json(await app.request('/api/projects/produto/sessions?active=true'))).sessions).toEqual([])
    expect((await json(await app.request('/api/projects/produto/sessions'))).sessions).toHaveLength(1)
  })

  it('refuses a task from another Project and an environment the panel does not know', async () => {
    const { db, ids, tasks } = await work()
    const foreign = await tasks.create(ids.other, { title: 'Elsewhere' }, null)
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    expect((await post(app, '/api/projects/produto/sessions', { taskId: foreign.id })).status).toBe(400)
    expect((await post(app, '/api/projects/produto/sessions', { environment: 'ghost' })).status).toBe(400)
  })
})

describe('activity', () => {
  it('lists a Project’s events newest first, with names resolved and filters applied', async () => {
    const { db, ids, tasks, activity } = await work()
    const task = await tasks.create(ids.project, { title: 'Fix auth' }, null)
    await activity.append({ kind: 'task.created', projectId: ids.project, taskId: task.id, repositoryId: ids.repository, summary: 'created' })
    await activity.append({ kind: 'environment.started', projectId: ids.project, environmentId: ids.environment, summary: 'alpha started', actorKind: 'human', actor: 'fabio' })
    await activity.append({ kind: 'task.status', projectId: ids.other, summary: 'elsewhere' })
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, db)
    const events = (await json(await app.request('/api/projects/produto/activity'))).events
    expect(events.map((event: { kind: string }) => event.kind)).toEqual(['environment.started', 'task.created'])
    expect(events[0]).toMatchObject({ project: 'produto', environment: 'alpha', actor: 'fabio' })
    expect(events[1]).toMatchObject({ taskTitle: 'Fix auth', repositoryName: 'api' })
    expect((await json(await app.request('/api/projects/produto/activity?kind=task.created'))).events).toHaveLength(1)
    expect((await json(await app.request(`/api/tasks/${task.id}/activity`))).events).toEqual([
      expect.objectContaining({ kind: 'task.created', taskId: task.id }),
    ])
    expect((await json(await app.request('/api/activity'))).events).toHaveLength(3)
  })

  it('records lifecycle operations on an environment, attributed to the Project that adopted it', async () => {
    const { db, ids, activity } = await work()
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, db)
    expect((await post(app, '/api/environments/alpha/actions/stop', {}, { 'X-Portta-Actor': 'claude-code' })).status).toBe(200)
    expect((await activity.list())[0]).toMatchObject({
      kind: 'environment.stopped', actor: 'claude-code', actorKind: 'agent',
      projectId: ids.project, environmentId: ids.environment,
    })
  })
})
