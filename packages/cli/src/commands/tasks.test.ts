import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Command } from 'commander'

const mocks = vi.hoisted(() => ({ requests: [] as { method: string; url: string; body: unknown; headers: Record<string, string> }[], answer: {} as unknown, tree: undefined as unknown, status: 200 }))
vi.mock('../context.js', () => ({
  gatewayContext: () => ({ root: '/tmp/portta', env: { PORTTA_WEB_PORT: '8081', PORTTA_TOKEN: 'ptt_secret' }, config: {}, composeFiles: [], version: 'test' }),
}))

import { tasksComment, tasksCreate, tasksDelete, tasksEdit, tasksFinish, tasksGitHubStatus, tasksLink, tasksList, tasksNext, tasksShow, tasksStart, tasksStatus, tasksSubtaskLink, tasksSync } from './tasks.js'
import { sessionsEnd, sessionsStart } from './sessions.js'
import { activityCommand } from './activity.js'

function command(globals: Record<string, unknown> = {}): Command {
  return { optsWithGlobals: () => ({ json: true, ...globals }) } as unknown as Command
}

let stdout = ''
afterEach(() => { vi.restoreAllMocks(); mocks.requests.length = 0; mocks.status = 200; mocks.tree = undefined; stdout = '' })

function stubFetch(answer: unknown, status = 200, tree?: unknown) {
  mocks.answer = answer
  mocks.tree = tree
  mocks.status = status
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    mocks.requests.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> })
    const payload = String(url).endsWith('/subtasks') && mocks.tree !== undefined ? mocks.tree : mocks.answer
    return new Response(JSON.stringify(payload), { status: mocks.status, headers: { 'content-type': 'application/json' } })
  })
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { stdout += String(chunk); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
}

describe('portta tasks', () => {
  it('lists a project’s tasks through the panel, with the credential and the actor', async () => {
    stubFetch({ tasks: [{ id: '1', title: 't', status: 'ready', subtaskCount: 0, openSubtaskCount: 0, github: null, repository: null, updatedAt: 1 }] })
    await tasksList({ project: 'shop', status: 'ready,blocked', open: true }, command({ actor: 'claude-code' }))
    expect(mocks.requests[0]).toMatchObject({ method: 'GET', url: 'http://127.0.0.1:8081/api/projects/shop/tasks?status=ready%2Cblocked&open=true' })
    expect(mocks.requests[0]!.headers['X-Portta-Actor']).toBe('claude-code')
    expect(mocks.requests[0]!.headers['authorization']).toBe('Bearer ptt_secret')
    expect(JSON.parse(stdout).tasks).toHaveLength(1)
  })

  it('lists globally without a project and requires one only for next', async () => {
    stubFetch({ tasks: [] })
    await tasksList({}, command())
    expect(mocks.requests[0]!.url).toBe('http://127.0.0.1:8081/api/tasks')
    await expect(tasksNext({}, command())).rejects.toThrow(/--project/)
  })

  it('creates and starts a task, and carries the panel’s refusal as words', async () => {
    stubFetch({ id: '7', title: 'x', status: 'backlog', notes: [], environments: [], subtasks: [], activeSessionCount: 0, github: null, repository: null, panelUrl: '#' })
    await tasksCreate({ project: 'shop', title: 'x', priority: 'high', labels: 'a, b', parent: '#3' }, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'POST', body: { title: 'x', priority: 'high', labels: ['a', 'b'], parentId: '3' } })
    await tasksStart('acme/api#42', { noAssign: true }, command())
    expect(mocks.requests[1]).toMatchObject({ url: 'http://127.0.0.1:8081/api/tasks/acme%2Fapi%2342/start', body: { assign: false } })

    stubFetch({ error: 'the task and its issue both changed; pass resolve: local or remote' }, 409)
    await expect(tasksSync('7', {}, command())).rejects.toThrow(/the panel answered 409: the task and its issue both changed/)
    await expect(tasksSync('7', { resolve: 'sideways' }, command())).rejects.toThrow(/--resolve/)
  })

  it('refuses a non-loopback panel without --allow-remote', async () => {
    stubFetch({})
    await expect(tasksList({ project: 'shop' }, command({ url: 'https://panel.example.com' }))).rejects.toThrow(/refusing to send a panel credential/)
    expect(mocks.requests).toEqual([])
  })

  it('updates, moves, comments and links subtasks exclusively through the API', async () => {
    stubFetch({ id: '7', title: 'x', status: 'review', notes: [], environments: [], subtasks: [], activeSessionCount: 0, github: null, repository: null, panelUrl: '#' })
    await tasksEdit('7', { status: 'in-progress', priority: 'high', agent: 'codex', deadline: '2026-09-10' }, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'PATCH', url: 'http://127.0.0.1:8081/api/tasks/7', body: { status: 'in_progress', priority: 'high', agent: 'codex', dueAt: 1788998400 } })
    await tasksStatus('7', 'review', {}, command())
    expect(mocks.requests[1]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/tasks/7/move', body: { status: 'review' } })
    stubFetch({ id: 'n1', actor: 'codex', body: 'done' })
    await tasksComment('7', undefined, { message: 'done' }, command())
    expect(mocks.requests[2]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/tasks/7/comments', body: { body: 'done' } })
    stubFetch({ id: '8', title: 'child', status: 'ready', notes: [], environments: [], subtasks: [], activeSessionCount: 0, github: null, repository: null, panelUrl: '#' })
    await tasksSubtaskLink('7', '#8', {}, command())
    expect(mocks.requests[3]).toMatchObject({ method: 'PUT', url: 'http://127.0.0.1:8081/api/tasks/7/subtasks/8' })
  })

  it('requires an explicit initial GitHub synchronization direction', async () => {
    stubFetch({ id: '7', title: 'x', status: 'ready', notes: [], environments: [], subtasks: [], activeSessionCount: 0, github: null, repository: null, panelUrl: '#' })
    await expect(tasksLink('7', 'acme/api#1', {}, command())).rejects.toThrow(/--pull or --push/)
    await tasksLink('7', 'acme/api#1', { pull: true }, command())
    expect(mocks.requests[0]).toMatchObject({ body: { issue: 'acme/api#1', initialSync: 'pull' } })
  })

  it('views a task as JSON with its subtask tree, finishes, comments from stdin, and deletes through the API', async () => {
    stubFetch(
      { id: '12', title: 'Metrics', status: 'todo', notes: [], environments: [], subtasks: [{ id: '21', title: 'Route', status: 'done' }], activeSessionCount: 0, github: null, repository: { id: '1', name: 'demo-shop' }, panelUrl: '#' },
      200,
      { subtasks: [{ task: { id: '21', title: 'Route', status: 'done' }, children: [] }] },
    )
    await tasksShow('12', command())
    expect(mocks.requests[0]).toMatchObject({ method: 'GET', url: 'http://127.0.0.1:8081/api/tasks/12' })
    expect(mocks.requests[1]).toMatchObject({ method: 'GET', url: 'http://127.0.0.1:8081/api/tasks/12/subtasks' })
    expect(JSON.parse(stdout).subtaskTree[0].task.id).toBe('21')

    mocks.requests.length = 0
    stubFetch({ id: '12', title: 'Metrics', status: 'done', notes: [], environments: [], subtasks: [], activeSessionCount: 0, github: null, repository: null, panelUrl: '#' })
    await tasksFinish('12', { close: true }, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/tasks/12/finish', body: { close: true } })

    mocks.requests.length = 0
    stubFetch({ id: 'n2', actor: 'codex', body: 'from stdin' })
    const chunks = [Buffer.from('from stdin')]
    vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* (): AsyncGenerator<Buffer, undefined> { yield* chunks })
    await tasksComment('12', undefined, { stdin: true }, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/tasks/12/comments', body: { body: 'from stdin' } })

    mocks.requests.length = 0
    stubFetch({ ok: true, removed: '12' })
    await tasksDelete('12', command({ yes: true }))
    expect(mocks.requests[0]).toMatchObject({ method: 'DELETE', url: 'http://127.0.0.1:8081/api/tasks/12' })

    mocks.requests.length = 0
    stdout = ''
    stubFetch({ id: '12', title: 'Metrics', status: 'ready', notes: [], environments: [], subtasks: [], activeSessionCount: 0, github: { repository: 'acme/api', number: 42, syncState: 'pending' }, repository: null, panelUrl: '#' })
    await tasksGitHubStatus('12', command())
    expect(JSON.parse(stdout)).toEqual({ github: { repository: 'acme/api', number: 42, syncState: 'pending' } })
  })
})

describe('portta sessions and activity', () => {
  it('starts and ends a session', async () => {
    stubFetch({ id: '9', actor: 'claude-code', status: 'active', commits: [] })
    await sessionsStart({ project: 'shop', task: '#7', environment: 'shop', summary: 'auth' }, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/projects/shop/sessions', body: { taskId: '7', environment: 'shop', summary: 'auth' } })
    stubFetch({ id: '9', actor: 'claude-code', status: 'ended', commits: [{ sha: 'a' }] })
    await sessionsEnd('9', { summary: 'done' }, command())
    expect(mocks.requests[1]).toMatchObject({ method: 'PATCH', url: 'http://127.0.0.1:8081/api/sessions/9', body: { status: 'ended', summary: 'done' } })
  })

  it('reads activity for a project or for the node', async () => {
    stubFetch({ events: [] })
    await activityCommand({ project: 'shop', kind: 'task.status', limit: '5' }, command())
    expect(mocks.requests[0]!.url).toBe('http://127.0.0.1:8081/api/projects/shop/activity?kind=task.status&limit=5')
    await activityCommand({}, command())
    expect(mocks.requests[1]!.url).toBe('http://127.0.0.1:8081/api/activity')
  })
})
