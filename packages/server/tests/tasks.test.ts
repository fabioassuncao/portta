// The task endpoints, over Portta's own tasks.
//
// The scheduling rules (next, blocked-by-subtasks, priority order) live in
// portta-core and are tested there. What is asserted here is the contract:
// local-first writes, the GitHub binding following when it can, the actor
// carried through, and read-only and capability refusals.

import { afterEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { githubIssues, projects as projectsTable, tasks as tasksTable } from 'portta-db'
import type { GitHubIntegration } from '../src/services/integrations/github/index.ts'
import type { TaskRow } from '../src/db/tasks.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { del, makeApp, post, seededDatabase, type SeededDatabase } from './helpers.ts'

const NOW = new Date('2026-01-01T12:00:00Z')

function issueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '1', githubId: 1, nodeId: 'I_1', repositoryId: 'r1', repository: 'acme/api',
    number: 123, title: 'Implementar refresh token', body: null, state: 'open',
    stateReason: null, issueType: null, workflowStatus: 'ready', priority: 'high',
    metadataSource: 'labels', labels: ['status:ready'], assignees: [],
    milestone: null, htmlUrl: 'https://github.com/acme/api/issues/123',
    isPullRequest: false, githubUpdatedAt: NOW, syncedAt: NOW,
    ...overrides,
  }
}

const open: SeededDatabase[] = []
afterEach(async () => {
  for (const seeded of open.splice(0)) await seeded.close()
})

/**
 * A panel with a Project, its repository, and whichever issues the test names.
 *
 * The rows are real: the checks, the enums, the cascades and the board's
 * advisory lock are the ones production runs. `seed` inserts a task the way the
 * repository does, so a test states a starting board rather than a starting
 * object graph.
 */
async function work(
  issues: Record<string, unknown>[] = [],
  options: { second?: boolean } = {},
) {
  const seeded = await seededDatabase()
  open.push(seeded)
  const ids = {
    project: seeded.ids.project,
    repository: seeded.ids.repository,
    githubRepository: seeded.ids.githubRepository,
    other: '',
  }

  if (options.second !== false) {
    const [other] = await seeded.db
      .insert(projectsTable)
      .values({ slug: 'outro', name: 'Outro' })
      .returning({ id: projectsTable.id })
    ids.other = String(other!.id)
  }

  for (const issue of issues) {
    await seeded.db.insert(githubIssues).values({
      githubId: issue['githubId'] as number,
      nodeId: issue['nodeId'] as string,
      repositoryId: Number(ids.githubRepository),
      number: issue['number'] as number,
      title: issue['title'] as string,
      body: (issue['body'] ?? null) as string | null,
      state: issue['state'] as 'open' | 'closed',
      stateReason: (issue['stateReason'] ?? null) as string | null,
      issueType: (issue['issueType'] ?? null) as string | null,
      workflowStatus: (issue['workflowStatus'] ?? null) as string | null,
      priority: (issue['priority'] ?? null) as string | null,
      metadataSource: (issue['metadataSource'] ?? 'none') as 'fields' | 'labels' | 'none',
      labels: (issue['labels'] ?? []) as string[],
      assignees: (issue['assignees'] ?? []) as string[],
      milestone: (issue['milestone'] ?? null) as never,
      htmlUrl: issue['htmlUrl'] as string,
      isPullRequest: (issue['isPullRequest'] ?? false) as boolean,
      githubUpdatedAt: issue['githubUpdatedAt'] as Date,
    })
  }

  /**
   * A task on the board, created the way the API creates one so it lands at the
   * end of its column. A test that cares about a specific rank says `position`,
   * and only then is the row written directly.
   */
  const seed = async (
    task: Partial<TaskRow> & { projectId: string; title: string },
  ): Promise<TaskRow> => {
    // A rank or a timestamp the test chose can only be written directly; without
    // either, the row goes in through the repository so it appends like the API.
    if (task.position === undefined && task.updatedAt === undefined) {
      return seeded.database.tasks.create(
        task.projectId,
        {
          title: task.title,
          ...(task.description === undefined ? {} : { description: task.description }),
          ...(task.status === undefined ? {} : { status: task.status }),
          ...(task.priority === undefined ? {} : { priority: task.priority }),
          ...(task.type === undefined ? {} : { type: task.type }),
          ...(task.labels === undefined ? {} : { labels: task.labels }),
          ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
          ...(task.agent === undefined ? {} : { agent: task.agent }),
          ...(task.parentId === undefined ? {} : { parentId: task.parentId }),
          ...(task.repositoryId === undefined ? {} : { repositoryId: task.repositoryId }),
          ...(task.environmentId === undefined ? {} : { environmentId: task.environmentId }),
          ...(task.service === undefined ? {} : { service: task.service }),
          ...(task.dueAt === undefined ? {} : { dueAt: task.dueAt }),
          ...(task.sourceKey === undefined ? {} : { sourceKey: task.sourceKey }),
          ...(task.draft === undefined ? {} : { draft: task.draft }),
        },
        task.createdBy ?? null,
      )
    }
    const [row] = await seeded.db
      .insert(tasksTable)
      .values({
        projectId: Number(task.projectId),
        title: task.title,
        description: task.description ?? null,
        status: task.status ?? 'backlog',
        priority: task.priority ?? null,
        type: task.type ?? null,
        labels: task.labels ?? [],
        assignee: task.assignee ?? null,
        agent: task.agent ?? null,
        createdBy: task.createdBy ?? null,
        parentId: task.parentId == null ? null : Number(task.parentId),
        repositoryId: task.repositoryId == null ? null : Number(task.repositoryId),
        environmentId: task.environmentId == null ? null : Number(task.environmentId),
        service: task.service ?? null,
        position: task.position ?? 1024,
        ...(task.updatedAt === undefined ? {} : { updatedAt: task.updatedAt }),
        dueAt: task.dueAt ?? null,
        sourceKey: task.sourceKey ?? null,
        draft: task.draft ?? false,
      })
      .returning({ id: tasksTable.id })
    return (await seeded.database.tasks.find(String(row!.id)))!
  }

  const rows = () => seeded.database.tasks.list({ limit: 2000 })
  // Newest first, which is what the repository answers and what these tests
  // read: `[0]` is the event the request under test just produced.
  const activity = () => seeded.database.activity.list({ limit: 500 })
  const issueRows = () => seeded.db.select().from(githubIssues).orderBy(asc(githubIssues.githubId))
  const issueByGithubId = async (githubId: number) => {
    const [row] = await seeded.db.select().from(githubIssues).where(eq(githubIssues.githubId, githubId))
    return row
  }

  return { db: seeded.database, seeded, ids, seed, rows, activity, issueRows, issueByGithubId }
}

/** A GitHub integration that confirms every write, and records what was sent. */
function fakeGitHub(sent: Record<string, unknown>[] = []) {
  const client = {
    patchAsInstallation: async (_id: number, _path: string, patch: Record<string, unknown>) => {
      sent.push(patch)
      return { data: { id: 1, node_id: 'I_1', number: 123, title: 'Implementar refresh token', body: null, state: patch['state'] ?? 'open', state_reason: null, labels: ((patch['labels'] as string[] | undefined) ?? []).map((name) => ({ name })), assignees: ((patch['assignees'] as string[] | undefined) ?? []).map((login) => ({ login })), milestone: null, html_url: 'https://github.com/acme/api/issues/123', updated_at: new Date(NOW.getTime() + 60_000).toISOString() }, next: null }
    },
    postAsInstallation: async (_id: number, path: string, body: Record<string, unknown>) => {
      sent.push({ path, ...body })
      if (path.endsWith('/comments')) {
        return { data: { id: 55, html_url: 'https://github.com/acme/api/issues/123#issuecomment-55', body: String(body['body']), created_at: NOW.toISOString() }, next: null }
      }
      return { data: { id: 77, node_id: 'I_77', number: 124, title: String(body['title']), body: body['body'] ?? null, state: 'open', state_reason: null, labels: [], assignees: [], milestone: null, html_url: 'https://github.com/acme/api/issues/124', updated_at: NOW.toISOString() }, next: null }
    },
  }
  return {
    status: () => ({ configured: true, available: true, reason: null, appId: 1, checkedAt: 0 }),
    require: () => client,
    check: async () => ({ available: true }),
    keyIsPrivate: () => true,
  } as unknown as GitHubIntegration
}

const json = (response: Response) => response.json() as Promise<Record<string, any>>

describe('local tasks', () => {
  it('creates, lists, reads and deletes a task with no GitHub at all', async () => {
    const { db, activity } = await work()
    const { app } = makeApp({ containers: GATEWAY }, {}, db)

    const created = await post(app, '/api/projects/produto/tasks', { title: 'Rever autenticação', priority: 'high' }, { 'X-Portta-Actor': 'fabio', 'X-Portta-Actor-Kind': 'human' })
    expect(created.status).toBe(201)
    const task = await json(created)
    expect(task).toMatchObject({ title: 'Rever autenticação', status: 'backlog', priority: 'high', project: 'produto', github: null, createdBy: 'fabio', environments: [], notes: [] })
    expect(task.panelUrl).toBe(`#/projects/produto/tasks/${task.id}`)

    const listed = await json(await app.request('/api/projects/produto/tasks'))
    expect(listed.tasks).toHaveLength(1)
    expect(await json(await app.request(`/api/tasks/${task.id}`))).toMatchObject({ id: task.id })
    expect(await json(await app.request(`/api/tasks/%23${task.id}`))).toMatchObject({ id: task.id })
    expect((await activity())[0]).toMatchObject({ kind: 'task.created', actor: 'fabio', actorKind: 'human', taskId: task.id })

    const removed = await app.request(`/api/tasks/${task.id}`, { method: 'DELETE', headers: { origin: 'http://localhost', host: 'localhost' } })
    expect(removed.status).toBe(200)
    expect((await json(await app.request('/api/projects/produto/tasks'))).tasks).toEqual([])
  })

  it('offers the next task, and null when there is none', async () => {
    const { db, seed, ids } = await work()
    await seed({ projectId: ids.project, title: 'backlog', status: 'backlog' })
    const ready = await seed({ projectId: ids.project, title: 'ready', status: 'ready', priority: 'low' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    expect((await json(await app.request('/api/projects/produto/tasks/next'))).task).toMatchObject({ id: ready.id })
    // Taken by somebody: `next` offers what is ready, not what is under way.
    await db.tasks.update(ready.id, { status: 'in_progress' })
    expect((await json(await app.request('/api/projects/produto/tasks/next'))).task).toBeNull()
  })

  it('nests subtasks, counts them, and refuses a parent from another Project', async () => {
    const { db, seed, ids, rows } = await work()
    const parent = await seed({ projectId: ids.project, title: 'Parent' })
    await seed({ projectId: ids.project, title: 'Child', parentId: parent.id, status: 'done' })
    await seed({ projectId: ids.project, title: 'Other child', parentId: parent.id })
    await seed({ projectId: ids.other, title: 'Elsewhere' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const tree = await json(await app.request(`/api/tasks/${parent.id}/subtasks`))
    expect(tree.subtasks.map((node: { task: { title: string } }) => node.task.title)).toEqual(['Child', 'Other child'])
    expect(await json(await app.request(`/api/tasks/${parent.id}`))).toMatchObject({ subtaskCount: 2, openSubtaskCount: 1 })
    const elsewhere = (await rows()).find((row) => row.title === 'Elsewhere')!
    const refused = await post(app, '/api/projects/produto/tasks', { title: 'x', parentId: elsewhere.id })
    expect(refused.status).toBe(400)
  })

  it('starts, moves and finishes a task, recording the actor on the way', async () => {
    const { db, seed, ids, activity } = await work()
    const task = await seed({ projectId: ids.project, title: 'Fix auth', status: 'ready' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const started = await json(await post(app, `/api/tasks/${task.id}/start`, {}, { 'X-Portta-Actor': 'claude-code' }))
    expect(started).toMatchObject({ status: 'in_progress', assignee: 'claude-code', agent: 'claude-code' })
    expect((await activity())[0]).toMatchObject({ kind: 'task.status', actor: 'claude-code', actorKind: 'agent' })

    const moved = await json(await post(app, `/api/tasks/${task.id}/status`, { status: 'review' }))
    expect(moved.status).toBe('review')
    expect((await post(app, `/api/tasks/${task.id}/status`, { status: 'shipped' })).status).toBe(400)

    const finished = await json(await post(app, `/api/tasks/${task.id}/finish`, {}))
    expect(finished.status).toBe('done')
    expect(finished.closedAt).not.toBeNull()
  })

  it('persists sparse ordering within and across board columns', async () => {
    const { db, seed, ids, activity } = await work()
    const first = await seed({ projectId: ids.project, title: 'First', status: 'ready', position: 1024 })
    const second = await seed({ projectId: ids.project, title: 'Second', status: 'ready', position: 2048 })
    const blocked = await seed({ projectId: ids.project, title: 'Blocked', status: 'blocked', position: 1024 })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const moved = await json(await post(app, `/api/tasks/${second.id}/move`, { status: 'ready', beforeId: null, afterId: first.id }, { 'X-Portta-Actor': 'codex', 'X-Portta-Source': 'cli' }))
    expect(moved.position).toBeLessThan(first.position)
    const listed = await json(await app.request('/api/projects/produto/tasks'))
    expect(listed.tasks.filter((item: { status: string }) => item.status === 'ready').map((item: { id: string }) => item.id)).toEqual([second.id, first.id])
    const crossed = await json(await post(app, `/api/tasks/${first.id}/move`, { status: 'blocked', beforeId: blocked.id, afterId: null }))
    expect(crossed).toMatchObject({ status: 'blocked' })
    expect(crossed.position).toBeGreaterThan(blocked.position)
    expect((await activity()).find((event) => event.source === 'cli')).toMatchObject({ source: 'cli', data: { position: { from: 2048 } } })
  })

  it('PATCH of status appends in the destination column and names the field that changed', async () => {
    const { db, seed, ids, activity } = await work()
    const ready = await seed({ projectId: ids.project, title: 'Stay', status: 'ready', position: 1024 })
    const task = await seed({ projectId: ids.project, title: 'Ship metrics', status: 'backlog', position: 1024, priority: 'low' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const moved = await json(await app.request(`/api/tasks/${task.id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'ready' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    }))
    expect(moved).toMatchObject({ status: 'ready' })
    expect(moved.position).toBeGreaterThan(ready.position)
    expect((await activity())[0]).toMatchObject({ kind: 'task.status', summary: '"Ship metrics" moved to ready' })

    const prioritised = await json(await app.request(`/api/tasks/${task.id}`, {
      method: 'PATCH', body: JSON.stringify({ priority: 'high' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    }))
    expect(prioritised.priority).toBe('high')
    expect((await activity())[0]).toMatchObject({ kind: 'task.updated', summary: '"Ship metrics" priority changed from low to high' })
  })

  it('keeps notes locally, with the actor', async () => {
    const { db, seed, ids } = await work()
    const task = await seed({ projectId: ids.project, title: 'Fix auth' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const note = await json(await post(app, `/api/tasks/${task.id}/notes`, { body: 'tests pass' }, { 'X-Portta-Actor': 'claude-code' }))
    expect(note).toMatchObject({ body: 'tests pass', actor: 'claude-code', actorKind: 'agent' })
    expect((await json(await app.request(`/api/tasks/${task.id}/notes`))).notes).toHaveLength(1)
    expect((await json(await app.request(`/api/tasks/${task.id}`))).notes).toHaveLength(1)

    const edited = await json(await app.request(`/api/tasks/${task.id}/notes/${note.id}`, {
      method: 'PATCH', body: JSON.stringify({ body: 'tests still pass' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', 'X-Portta-Actor': 'claude-code' },
    }))
    expect(edited.body).toBe('tests still pass')
    expect(edited.updatedAt).not.toBeNull()

    const refused = await app.request(`/api/tasks/${task.id}/notes/${note.id}`, {
      method: 'PATCH', body: JSON.stringify({ body: 'no' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', 'X-Portta-Actor': 'someone-else' },
    })
    expect(refused.status).toBe(400)

    const removed = await json(await app.request(`/api/tasks/${task.id}/notes/${note.id}`, {
      method: 'DELETE',
      headers: { origin: 'http://localhost', host: 'localhost', 'X-Portta-Actor': 'claude-code' },
    }))
    expect(removed).toMatchObject({ ok: true, removed: note.id })
    expect((await json(await app.request(`/api/tasks/${task.id}/notes`))).notes).toHaveLength(0)
  })

  it('links a task to a running environment by hand, and refuses one that is not', async () => {
    const { db, seed, ids } = await work()
    const task = await seed({ projectId: ids.project, title: 'Fix auth' })
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, db)
    const put = (environments: string[]) => app.request(`/api/tasks/${task.id}/environments`, {
      method: 'PUT', body: JSON.stringify({ environments }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    const linked = await json(await put(['alpha']))
    expect(linked.environments[0]).toMatchObject({ environment: 'alpha', source: 'manual', running: true, panelUrl: '#/environments/alpha' })
    expect((await put(['ghost'])).status).toBe(400)
    expect(docker.calls.filter((call) => ['start', 'stop', 'restart', 'remove'].includes(call.method))).toEqual([])
  })

  it('reads a task out of an environment by its portta.task label, branch or namespace', async () => {
    const { db, seed, ids } = await work()
    const task = await seed({ projectId: ids.project, title: 'Fix auth' })
    const containers = PROJECT_A.map((container) => ({ ...container, labels: { ...container.labels, 'portta.task': `#${task.id}` } }))
    const { app } = makeApp({ containers: [...GATEWAY, ...containers] }, {}, db)
    const environment = await json(await app.request('/api/environments/alpha'))
    expect(environment.task).toMatchObject({ id: task.id, title: 'Fix auth', source: 'label', github: null, panelUrl: `#/projects/produto/tasks/${task.id}` })
    expect(environment.issue).toBeUndefined()
  })
})

describe('the GitHub binding', () => {
  it('reaches GitHub first on a bound task, and the binding says synced', async () => {
    const { db, seed, ids, issueByGithubId } = await work([issueRow()])
    const task = await seed({ projectId: ids.project, title: 'Implementar refresh token', status: 'ready', repositoryId: ids.repository })
    await db.tasks.upsertLink({ taskId: task.id, githubIssueId: '1', syncState: 'synced', remoteUpdatedAt: NOW, localUpdatedAt: NOW })
    const sent: Record<string, unknown>[] = []
    const { app } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub(sent))

    const started = await json(await post(app, '/api/tasks/acme%2Fapi%23123/start', {}, { 'X-Portta-Actor': 'claude-code' }))
    expect(started.github).toMatchObject({ repository: 'acme/api', number: 123, syncState: 'synced' })
    expect(sent[0]).toMatchObject({ labels: ['status:in-progress'], assignees: ['claude-code'] })
    expect(JSON.stringify(sent)).not.toContain('X-Portta-Actor')
    expect((await issueByGithubId(1))?.workflowStatus).toBe('in_progress')

    const finished = await json(await post(app, `/api/tasks/${task.id}/finish`, { close: true }))
    expect(sent[1]).toMatchObject({ labels: ['status:done'], state: 'closed' })
    expect(finished.github.state).toBe('closed')
  })

  it('writes locally and marks the binding pending when the App is not configured, then pushes on sync', async () => {
    const { db, seed, ids } = await work([issueRow()])
    const task = await seed({ projectId: ids.project, title: 'Implementar refresh token', status: 'ready' })
    await db.tasks.upsertLink({ taskId: task.id, githubIssueId: '1', syncState: 'synced', remoteUpdatedAt: NOW, localUpdatedAt: NOW })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const moved = await json(await post(app, `/api/tasks/${task.id}/status`, { status: 'review' }))
    expect(moved).toMatchObject({ status: 'review', github: { syncState: 'pending' } })

    expect((await post(app, `/api/tasks/${task.id}/github/sync`, {})).status).toBe(400)

    const sent: Record<string, unknown>[] = []
    const { app: connected } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub(sent))
    const synced = await json(await post(connected, `/api/tasks/${task.id}/github/sync`, {}))
    expect(synced.github.syncState).toBe('synced')
    expect(sent[0]).toMatchObject({ labels: ['status:review'] })
  })

  it('refuses to settle a conflict without a choice, and takes the remote when told to', async () => {
    const { db, seed, ids } = await work([issueRow({ title: 'Remote title', workflowStatus: 'blocked', labels: ['status:blocked'] })])
    const task = await seed({ projectId: ids.project, title: 'Local title', status: 'review' })
    await db.tasks.upsertLink({ taskId: task.id, githubIssueId: '1', syncState: 'conflict', remoteUpdatedAt: NOW, localUpdatedAt: NOW })
    const { app } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub())
    const shown = await json(await app.request(`/api/tasks/${task.id}`))
    expect(shown.github).toMatchObject({ syncState: 'conflict', remote: { title: 'Remote title', status: 'blocked' } })
    expect((await post(app, `/api/tasks/${task.id}/github/sync`, {})).status).toBe(409)
    const settled = await json(await post(app, `/api/tasks/${task.id}/github/sync`, { resolve: 'remote' }))
    expect(settled).toMatchObject({ title: 'Remote title', status: 'blocked', github: { syncState: 'synced' } })
  })

  it('links to a projected issue, refuses a pull request and an issue already bound, and unlinks', async () => {
    const { db, seed, ids } = await work([issueRow(), issueRow({ id: '2', githubId: 2, number: 124, isPullRequest: true })])
    const task = await seed({ projectId: ids.project, title: 'Local' })
    const other = await seed({ projectId: ids.project, title: 'Other' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    expect((await post(app, `/api/tasks/${task.id}/github/link`, { issue: 'acme/api#124', initialSync: 'pull' })).status).toBe(400)
    const linked = await json(await post(app, `/api/tasks/${task.id}/github/link`, { issue: 'acme/api#123', initialSync: 'pull' }))
    expect(linked).toMatchObject({ title: 'Implementar refresh token', status: 'ready', priority: 'high', github: { number: 123, syncState: 'synced' } })
    expect((await post(app, `/api/tasks/${other.id}/github/link`, { issue: 'acme/api#123', initialSync: 'pull' })).status).toBe(400)
    expect((await json(await post(app, `/api/tasks/${task.id}/github/unlink`, {}))).github).toBeNull()
  })

  it('publishes a task as a new issue on the repository it belongs to', async () => {
    const { db, seed, ids } = await work([])
    const task = await seed({ projectId: ids.project, title: 'Ship it', status: 'ready', priority: 'urgent', repositoryId: ids.repository })
    const sent: Record<string, unknown>[] = []
    const { app } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub(sent))
    const published = await post(app, `/api/tasks/${task.id}/github/publish`, {})
    expect(published.status).toBe(201)
    expect(sent[0]).toMatchObject({ path: '/repos/acme/api/issues', title: 'Ship it', labels: ['status:ready', 'priority:urgent'] })
    expect((await json(published)).github).toMatchObject({ number: 124, syncState: 'synced' })
  })

  it('refuses to publish an intact draft', async () => {
    const { db, seed, ids } = await work()
    const task = await seed({ projectId: ids.project, title: 'New task', draft: true, repositoryId: ids.repository })
    const { app } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub())
    expect((await post(app, `/api/tasks/${task.id}/github/publish`, {})).status).toBe(400)
  })

  it('stores comments locally and only publishes an explicit copy to GitHub', async () => {
    const { db, seed, ids } = await work([issueRow()])
    const bound = await seed({ projectId: ids.project, title: 'Bound' })
    await db.tasks.upsertLink({ taskId: bound.id, githubIssueId: '1', syncState: 'synced' })
    const unbound = await seed({ projectId: ids.project, title: 'Unbound' })
    const sent: Record<string, unknown>[] = []
    const { app } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub(sent))
    const comment = await post(app, `/api/tasks/${bound.id}/comments`, { body: 'done' }, { 'X-Portta-Actor': 'claude-code' })
    expect(comment.status).toBe(201)
    const local = await json(comment)
    expect(local).toMatchObject({ body: 'done', publishState: 'local' })
    expect(sent).toHaveLength(0)
    const published = await post(app, `/api/tasks/${bound.id}/comments/${local.id}/github/publish`, {})
    expect(await json(published)).toMatchObject({ body: 'done', publishState: 'synced', githubCommentId: 55 })
    expect(sent[0]).toEqual({ path: '/repos/acme/api/issues/123/comments', body: 'done' })
    const unboundComment = await json(await post(app, `/api/tasks/${unbound.id}/comments`, { body: 'x' }))
    expect((await post(app, `/api/tasks/${unbound.id}/comments/${unboundComment.id}/github/publish`, {})).status).toBe(400)
  })

  it('refuses a coordinate that is projected but bound to no task', async () => {
    const { db } = await work([issueRow()])
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    expect((await app.request('/api/tasks/acme%2Fapi%23123')).status).toBe(404)
    expect((await app.request('/api/tasks/acme%2Fapi%23999')).status).toBe(404)
  })

  it('projects a new issue as a task on the repository that owns it, and follows a later change', async () => {
    const { applyIssueToTask } = await import('../src/services/integrations/github/tasks.ts')
    // The issue has to exist: `task_github_links` points at it, and the panel
    // never invents a binding to a row the projection does not hold.
    const { db, ids, rows } = await work([issueRow()])
    const owner = async () => ({ projectId: ids.project, repositoryId: ids.repository })
    const first = await applyIssueToTask(db.tasks, issueRow() as never, owner)
    expect(first.outcome).toBe('created')
    expect(first.task).toMatchObject({ title: 'Implementar refresh token', status: 'ready', priority: 'high', repositoryId: ids.repository, createdBy: 'github' })

    const later = await applyIssueToTask(db.tasks, issueRow({ title: 'Renamed', githubUpdatedAt: new Date(NOW.getTime() + 60_000) }) as never, owner)
    expect(later.outcome).toBe('applied')
    expect((await rows())[0]!.title).toBe('Renamed')

    await db.tasks.setLinkState(first.task!.id, 'pending', { localUpdatedAt: new Date(NOW.getTime() + 120_000) })
    const clash = await applyIssueToTask(db.tasks, issueRow({ title: 'Renamed again', githubUpdatedAt: new Date(NOW.getTime() + 180_000) }) as never, owner)
    expect(clash.outcome).toBe('conflict')
    expect((await rows())[0]!.title).toBe('Renamed')
  })
})

describe('kick-create drafts', () => {
  it('reuses one intact draft per actor, keeps it off the board, and promotes on a real title', async () => {
    const { db, rows, activity } = await work()
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const headers = { 'X-Portta-Actor': 'fabio', 'X-Portta-Actor-Kind': 'human' }
    const first = await post(app, '/api/projects/produto/tasks', { title: 'New task', draft: true }, headers)
    expect(first.status).toBe(201)
    const draft = await json(first)
    expect(draft).toMatchObject({ title: 'New task', draft: true, status: 'backlog' })
    expect(await activity()).toEqual([])
    expect((await json(await app.request('/api/projects/produto/tasks'))).tasks).toEqual([])
    expect((await json(await app.request('/api/projects/produto/tasks?draft=true'))).tasks).toHaveLength(1)
    expect((await json(await app.request('/api/projects/produto/tasks/next'))).task).toBeNull()

    const reused = await post(app, '/api/projects/produto/tasks', { title: 'New task', draft: true }, headers)
    expect(reused.status).toBe(200)
    expect((await json(reused)).id).toBe(draft.id)
    expect((await rows()).filter((row) => row.draft)).toHaveLength(1)

    const promoted = await json(await app.request(`/api/tasks/${draft.id}`, {
      method: 'PATCH', body: JSON.stringify({ title: 'Configurar API' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', 'X-Portta-Actor': 'fabio' },
    }))
    expect(promoted).toMatchObject({ title: 'Configurar API', draft: false })
    expect((await activity())[0]).toMatchObject({ kind: 'task.created', taskId: draft.id })
    expect((await json(await app.request('/api/projects/produto/tasks'))).tasks).toHaveLength(1)
  })

  it('sweeps an untouched draft older than a day, stores a due date, and refuses a parent cycle', async () => {
    const { db, seed, ids, rows } = await work()
    await seed({
      projectId: ids.project, title: 'New task', draft: true, createdBy: 'fabio',
      updatedAt: new Date('2020-01-01T00:00:00Z'),
    })
    const parent = await seed({ projectId: ids.project, title: 'Parent' })
    const child = await seed({ projectId: ids.project, title: 'Child', parentId: parent.id })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const created = await json(await post(app, '/api/projects/produto/tasks', {
      title: 'New task', draft: true, dueAt: 1_735_689_600,
    }, { 'X-Portta-Actor': 'ada' }))
    expect(created.dueAt).toBe(1_735_689_600)
    expect((await rows()).some((row) => row.createdBy === 'fabio' && row.draft)).toBe(false)

    const cycled = await app.request(`/api/tasks/${parent.id}`, {
      method: 'PATCH', body: JSON.stringify({ parentId: child.id }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(cycled.status).toBe(400)
  })

  it('imports a document by source_key and exports the same keys', async () => {
    const { db } = await work()
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const document = {
      schemaVersion: 1,
      project: { slug: 'produto', name: 'Produto' },
      tasks: [{
        key: 'shop-auth', title: 'Auth', environment: 'alpha',
        comments: [{ key: 'auth-note', actor: 'fabio', body: 'start here' }],
        subtasks: [{ key: 'shop-auth-ui', title: 'UI' }],
      }],
    }
    const first = await json(await post(app, '/api/projects/produto/tasks/import', document))
    expect(first).toMatchObject({ created: 2, updated: 0 })
    expect(first.tasks.map((task: { title: string }) => task.title)).toEqual(['Auth', 'UI'])
    expect(first.tasks[0].notes[0]).toMatchObject({ body: 'start here' })

    document.tasks[0]!.title = 'Auth (renamed)'
    const second = await json(await post(app, '/api/projects/produto/tasks/import', document))
    expect(second).toMatchObject({ created: 0, updated: 2 })
    expect(second.tasks[0].title).toBe('Auth (renamed)')

    const exported = await json(await app.request('/api/projects/produto/tasks/export'))
    expect(exported.tasks.map((task: { key: string }) => task.key)).toEqual(['shop-auth'])
    expect(exported.tasks[0].subtasks[0].key).toBe('shop-auth-ui')
  })
})

describe('refusals', () => {
  it('refuses every write in read-only mode, and leaves the reads', async () => {
    const { db, seed, ids } = await work()
    const task = await seed({ projectId: ids.project, title: 't' })
    const { app } = makeApp({ containers: GATEWAY }, { readOnly: true }, db)
    expect((await app.request(`/api/tasks/${task.id}`)).status).toBe(200)
    for (const path of [`/api/tasks/${task.id}/start`, `/api/tasks/${task.id}/notes`, '/api/projects/produto/tasks']) {
      expect((await post(app, path, { title: 'x', body: 'x' })).status).toBe(403)
    }
  })
})

describe('attachments', () => {
  async function upload(app: Parameters<typeof post>[0], path: string, file: File, filename?: string): Promise<Response> {
    const form = new FormData()
    form.set('file', file)
    if (filename) form.set('filename', filename)
    return app.request(path, {
      method: 'POST',
      body: form,
      headers: { origin: 'http://localhost', host: 'localhost' },
    })
  }

  it('stores a file, lists it and serves the bytes back', async () => {
    const { db, seed, ids } = await work()
    const task = await seed({ projectId: ids.project, title: 'Fix the queue' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)

    const created = await upload(app, `/api/tasks/${task.id}/attachments`, new File(['{"a":1}'], 'payload.json', { type: 'application/json' }))
    expect(created.status).toBe(201)
    const attachment = await json(created)
    expect(attachment).toMatchObject({ filename: 'payload.json', contentType: 'application/json', kind: 'text', sizeBytes: 7 })

    const listed = await json(await app.request(`/api/tasks/${task.id}/attachments`))
    expect(listed.attachments).toHaveLength(1)

    // The bytes are behind the URL, not in the task payload.
    const detail = await json(await app.request(`/api/tasks/${task.id}`))
    expect(detail.attachments[0].downloadUrl).toBe(`/api/tasks/${task.id}/attachments/${attachment.id}`)
    expect(detail.attachmentCount).toBe(1)

    const bytes = await app.request(attachment.downloadUrl)
    expect(bytes.status).toBe(200)
    expect(bytes.headers.get('content-type')).toBe('application/json')
    expect(bytes.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await bytes.text()).toBe('{"a":1}')
  })

  it('names an image inline and a download as a download', async () => {
    const { db, seed, ids } = await work()
    const task = await seed({ projectId: ids.project, title: 't' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)

    const image = await json(await upload(app, `/api/tasks/${task.id}/attachments`, new File(['png'], 'shot.png', { type: 'image/png' })))
    const served = await app.request(image.downloadUrl)
    expect(served.headers.get('content-disposition')).toMatch(/^inline;/)

    const binary = await json(await upload(app, `/api/tasks/${task.id}/attachments`, new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' })))
    expect(binary.contentType).toBe('application/octet-stream')
    expect((await app.request(binary.downloadUrl)).headers.get('content-disposition')).toMatch(/^attachment;/)
  })

  it('refuses a file that is too large, and says by how much', async () => {
    const { db, seed, ids } = await work()
    const task = await seed({ projectId: ids.project, title: 't' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const oversized = new File(['x'.repeat(11 * 1024 * 1024)], 'huge.log', { type: 'text/plain' })
    const refused = await upload(app, `/api/tasks/${task.id}/attachments`, oversized)
    expect(refused.status).toBe(400)
    expect((await json(refused)).error).toContain('the limit is 10 MB')
  })

  it('refuses a request with no file part at all', async () => {
    const { db, seed, ids } = await work()
    const task = await seed({ projectId: ids.project, title: 't' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const response = await app.request(`/api/tasks/${task.id}/attachments`, {
      method: 'POST',
      body: new FormData(),
      headers: { origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(400)
  })

  it('stores a traversing name as one safe segment', async () => {
    const { db, seed, ids } = await work()
    const task = await seed({ projectId: ids.project, title: 't' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const created = await json(await upload(app, `/api/tasks/${task.id}/attachments`, new File(['x'], 'x.txt', { type: 'text/plain' }), '../../etc/passwd'))
    expect(created.filename).toBe('passwd')
  })

  it('removes an attachment and stops serving it', async () => {
    const { db, seed, ids, activity } = await work()
    const task = await seed({ projectId: ids.project, title: 't' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const created = await json(await upload(app, `/api/tasks/${task.id}/attachments`, new File(['x'], 'note.txt', { type: 'text/plain' })))

    expect((await del(app, created.downloadUrl)).status).toBe(200)
    expect((await app.request(created.downloadUrl)).status).toBe(404)
    expect((await activity()).map((row) => row.summary)).toContainEqual(expect.stringContaining('removed note.txt'))
  })

  it('answers 404 for an attachment of another task', async () => {
    const { db, seed, ids } = await work()
    const mine = await seed({ projectId: ids.project, title: 'mine' })
    const other = await seed({ projectId: ids.project, title: 'other' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const created = await json(await upload(app, `/api/tasks/${mine.id}/attachments`, new File(['x'], 'a.txt', { type: 'text/plain' })))
    expect((await app.request(`/api/tasks/${other.id}/attachments/${created.id}`)).status).toBe(404)
  })

  it('refuses to attach anything in read-only mode', async () => {
    const { db, seed, ids } = await work()
    const task = await seed({ projectId: ids.project, title: 't' })
    const { app } = makeApp({ containers: GATEWAY }, { readOnly: true }, db)
    const refused = await upload(app, `/api/tasks/${task.id}/attachments`, new File(['x'], 'a.txt', { type: 'text/plain' }))
    expect(refused.status).toBe(403)
  })
})
