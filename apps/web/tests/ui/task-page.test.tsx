import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { principal, renderWithQuery } from './render.tsx'
import { navigation } from './setup.ts'
import { makeEvent, makeSession, makeTask, makeTaskSummary } from './fixtures.ts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.status = status
    this.hint = hint
  }
}

const task = vi.fn()
const project = vi.fn()
const tasks = vi.fn()
const sessions = vi.fn()
const projectActivity = vi.fn()
const github = vi.fn()
const setTaskStatus = vi.fn()
const startTask = vi.fn()
const finishTask = vi.fn()
const addTaskNote = vi.fn()
const patchTask = vi.fn()
const syncTaskGitHub = vi.fn()
const linkTaskGitHub = vi.fn()
const setTaskEnvironments = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    task: (id: string) => task(id),
    project: (slug: string) => project(slug),
    tasks: (slug: string) => tasks(slug),
    sessions: (slug: string, filters: unknown) => sessions(slug, filters),
    projectActivity: (slug: string, filters: unknown) => projectActivity(slug, filters),
    github: () => github(),
    setTaskStatus: (id: string, status: string) => setTaskStatus(id, status),
    startTask: (id: string) => startTask(id),
    finishTask: (id: string, close?: boolean) => finishTask(id, close),
    patchTask: (id: string, body: unknown) => patchTask(id, body),
    addTaskComment: (id: string, body: string) => addTaskNote(id, body),
    updateTaskComment: vi.fn(),
    deleteTaskComment: vi.fn(),
    publishTaskCommentGitHub: vi.fn(),
    linkTaskSubtask: vi.fn(),
    unlinkTaskSubtask: vi.fn(),
    syncTaskGitHub: (id: string, resolve?: string) => syncTaskGitHub(id, resolve),
    linkTaskGitHub: (id: string, issue: string, initialSync: string) => linkTaskGitHub(id, issue, initialSync),
    setTaskEnvironments: (id: string, environments: string[]) => setTaskEnvironments(id, environments),
  },
}))

const { TaskPageView } = await import('@/components/tasks/task-page-view')

const PROJECT = {
  id: '1', slug: 'produto', name: 'Meu Produto', description: null, archived: false,
  relativePath: null, resolvedPath: null, location: 'external' as const,
  repositories: [], githubRepositories: [],
  environments: [{ environment: 'produto', source: 'manual' as const, running: true, serviceCount: 1, runningCount: 1, unhealthyCount: 0, urls: [] }],
}

/** The page's server half read the task and the project; the view takes them. */
function view(options: { id?: string; from?: string; task?: unknown } = {}) {
  return (
    <TaskPageView
      slug="produto"
      id={options.id ?? '42'}
      from={options.from ?? null}
      initialTask={(options.task ?? detail) as never}
      initialProject={PROJECT as never}
    />
  )
}

const detail = makeTask({
  subtasks: [makeTaskSummary({ id: '43', title: 'Backend', parentId: '42', status: 'done' }), makeTaskSummary({ id: '44', title: 'Frontend', parentId: '42', repository: { id: 'r2', name: 'web' } })],
  subtaskCount: 2,
  openSubtaskCount: 1,
  notes: [{ id: 'n1', actor: 'claude', actorKind: 'agent', body: 'Tests pass locally.', createdAt: 1_700_000_100, updatedAt: null, publishState: 'local', githubCommentId: null, githubHtmlUrl: null, publishError: null }],
  environments: [{ environment: 'produto-task42', source: 'branch', reason: 'linked because this environment is on branch task-42-auth', running: true, serviceCount: 2, runningCount: 2, unhealthyCount: 0, branch: 'task-42-auth', urls: [{ url: 'http://produto-web.localhost', scope: 'local' }], panelUrl: '/environments/produto-task42' }],
})

beforeEach(() => {
  sessionStorage.clear()
  navigation.push.mockReset()
  task.mockReset().mockResolvedValue(detail)
  tasks.mockReset().mockResolvedValue([])
  project.mockReset().mockResolvedValue({ id: '1', slug: 'produto', name: 'Meu Produto', description: null, archived: false, relativePath: null, resolvedPath: null, location: 'external', repositories: [], githubRepositories: [], environments: [{ environment: 'produto', source: 'manual', running: true, serviceCount: 1, runningCount: 1, unhealthyCount: 0, urls: [] }] })
  sessions.mockReset().mockResolvedValue([makeSession()])
  projectActivity.mockReset().mockResolvedValue({ events: [makeEvent()], nextBefore: null })
  github.mockReset().mockResolvedValue({ status: { configured: true } })
  setTaskStatus.mockReset().mockResolvedValue(detail)
  startTask.mockReset().mockResolvedValue(detail)
  finishTask.mockReset().mockResolvedValue(detail)
  addTaskNote.mockReset().mockResolvedValue(detail.notes[0])
  patchTask.mockReset().mockResolvedValue(detail)
  syncTaskGitHub.mockReset().mockResolvedValue(detail)
  linkTaskGitHub.mockReset().mockResolvedValue(detail)
  setTaskEnvironments.mockReset().mockResolvedValue(detail)
})

describe('one task', () => {
  it('shows what it is, who is on it, what came out, and where it runs', async () => {
    renderWithQuery(view({ id: '42' }))
    expect(await screen.findByRole('heading', { name: 'Implementar refresh token' })).toBeInTheDocument()
    expect(screen.getByText('The refresh token expires too early.')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '#44 Frontend' })).toBeInTheDocument()
    expect(screen.getByText(/Subtasks 1\/2/)).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: 'claude session' })).toBeInTheDocument()
    expect(await screen.findByText('Add totals')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'produto-task42' })).toHaveAttribute('href', '/environments/produto-task42')
    expect(screen.getByText('Tests pass locally.')).toBeInTheDocument()
    expect(await screen.findByText('#42 moved to in progress')).toBeInTheDocument()
    expect(screen.getByText(/not bound to a GitHub issue/i)).toBeInTheDocument()
  })

  it('walks Tasks and the project when the task was opened from the global list', async () => {
    sessionStorage.setItem('portta-tasks-return', JSON.stringify({ href: '/tasks?view=board&status=blocked', scroll: 0 }))
    renderWithQuery(view({ id: '42', from: 'tasks' }))
    await screen.findByRole('heading', { name: 'Implementar refresh token' })
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/tasks?view=board&status=blocked')
    expect(await within(nav).findByRole('link', { name: 'Meu Produto' })).toHaveAttribute('href', '/projects/produto')
    expect(within(nav).queryByRole('link', { name: 'Projects' })).toBeNull()
    expect(within(nav).getByText('#42')).toHaveAttribute('aria-current', 'page')
  })

  it('walks Projects, the project and Tasks in the breadcrumb, with no link trio below the title', async () => {
    renderWithQuery(view({ id: '42' }))
    await screen.findByRole('heading', { name: 'Implementar refresh token' })
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    expect(await within(nav).findByRole('link', { name: 'Meu Produto' })).toHaveAttribute('href', '/projects/produto')
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/projects/produto/tasks')
    expect(within(nav).getByText('#42')).toHaveAttribute('aria-current', 'page')
    // The crumb is where the page says which task this is, so the column
    // above the content holds the title and nothing repeating it.
    const heading = screen.getByRole('heading', { name: 'Implementar refresh token' })
    expect(heading.parentElement?.parentElement).toHaveTextContent(/^Implementar refresh token$/)
    expect(screen.queryByRole('link', { name: 'All tasks' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Part of #42' })).toBeNull()
  })

  it('adds the parent task as a crumb of a subtask', async () => {
    task.mockResolvedValue(makeTask({ id: '44', title: 'Frontend', parentId: '42', subtasks: [], subtaskCount: 0, openSubtaskCount: 0 }))
    renderWithQuery(view({ id: '44' }))
    await screen.findByRole('heading', { name: 'Frontend' })
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: '#42' })).toHaveAttribute('href', '/projects/produto/tasks/42')
    expect(within(nav).getByText('#44')).toHaveAttribute('aria-current', 'page')
  })

  it('sends the task to review and adds a note', async () => {
    renderWithQuery(view({ id: '42' }))
    await screen.findByRole('heading', { name: 'Implementar refresh token' })
    await userEvent.click(screen.getByRole('button', { name: 'Send to review' }))
    await waitFor(() => expect(setTaskStatus).toHaveBeenCalledWith('42', 'review'))
    await userEvent.type(screen.getByPlaceholderText(/Leave a note/), 'Please retry the flaky test')
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }))
    await waitFor(() => expect(addTaskNote).toHaveBeenCalledWith('42', 'Please retry the flaky test'))
  })

  it('edits status from the quiet properties sidebar', async () => {
    renderWithQuery(view({ id: '42' }))
    await screen.findByRole('heading', { name: 'Implementar refresh token' })
    await userEvent.click(screen.getByRole('button', { name: 'In progress' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Blocked' }))
    await waitFor(() => expect(patchTask).toHaveBeenCalledWith('42', { status: 'blocked' }))
  })

  it('completes a subtask directly from its progress list', async () => {
    renderWithQuery(view({ id: '42' }))
    await screen.findByRole('heading', { name: 'Implementar refresh token' })
    await userEvent.click(screen.getByRole('button', { name: 'Complete subtask #44' }))
    await waitFor(() => expect(setTaskStatus).toHaveBeenCalledWith('44', 'done'))
  })

  it('binds an issue by its coordinate', async () => {
    renderWithQuery(view({ id: '42' }))
    // The form is there from the first paint but stays disabled until the
    // GitHub status says the App is configured, which is a query of its own.
    const field = await screen.findByPlaceholderText('owner/repo#42')
    await waitFor(() => expect(field).toBeEnabled())
    await userEvent.type(field, 'acme/api#7')
    await userEvent.click(await screen.findByRole('button', { name: 'Bind an issue' }))
    await waitFor(() => expect(linkTaskGitHub).toHaveBeenCalledWith('42', 'acme/api#7', 'pull'))
  })

  it('shows a conflict with both sides and lets a person choose', async () => {
    task.mockResolvedValue(makeTask({
      github: { repository: 'acme/api', number: 7, htmlUrl: 'https://github.com/acme/api/issues/7', state: 'open', syncState: 'conflict', lastSyncedAt: 1_700_000_000, lastError: null, remoteUpdatedAt: 1_700_000_500, metadataSource: 'labels', remote: { title: 'Refresh token (renamed)', status: 'review', priority: null, assignee: 'ada' } },
    }))
    renderWithQuery(view({ id: '42' }))
    expect(await screen.findByText(/Refresh token \(renamed\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: "Take GitHub's" }))
    await waitFor(() => expect(syncTaskGitHub).toHaveBeenCalledWith('42', 'remote'))
  })

  it('says when the task does not exist, still under its project and Tasks', async () => {
    task.mockRejectedValue(new ApiError(404, 'no task'))
    renderWithQuery(view({ id: '99' }))
    expect(await screen.findByText('No task #99')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All tasks' })).toHaveAttribute('href', '/projects/produto/tasks')
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/projects/produto/tasks')
    expect(within(nav).getByText('#99')).toHaveAttribute('aria-current', 'page')
  })
})

describe('what the task actions promise', () => {
  it('says the start button will also take the task, and does both', async () => {
    const ready = makeTask({ status: 'ready', github: null })
    task.mockResolvedValue(ready)
    renderWithQuery(view({ task: ready }))
    const start = await screen.findByRole('button', { name: 'Start and take it' })
    await userEvent.hover(start)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('puts your name on it as the assignee')
    await userEvent.click(start)
    expect(startTask).toHaveBeenCalledWith('42')
  })

  it('names the issue it will close, rather than saying "Finish"', async () => {
    const inReview = makeTask({
      status: 'review',
      github: { repository: 'acme/api', number: 7, htmlUrl: 'https://github.com/acme/api/issues/7', state: 'open', syncState: 'synced', lastSyncedAt: 1, lastError: null, remoteUpdatedAt: null, metadataSource: 'fields', remote: null },
    })
    task.mockResolvedValue(inReview)
    renderWithQuery(view({ task: inReview }))
    const done = await screen.findByRole('button', { name: 'Mark done and close the issue' })
    await userEvent.hover(done)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('acme/api#7')
  })

  it('keeps changing a status separate from taking the task', async () => {
    const ready = makeTask({ status: 'ready', github: null })
    task.mockResolvedValue(ready)
    renderWithQuery(view({ task: ready }))
    await userEvent.click(await screen.findByRole('button', { name: 'Change status' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Blocked' }))
    expect(setTaskStatus).toHaveBeenCalledWith('42', 'blocked')
    expect(startTask).not.toHaveBeenCalled()
  })

  it('says how an agent session actually starts, since the panel cannot start one', async () => {
    const ready = makeTask({ status: 'ready' })
    task.mockResolvedValue(ready)
    sessions.mockResolvedValue([])
    renderWithQuery(view({ task: ready }))
    expect(await screen.findByText(/portta sessions start --task 42/)).toBeInTheDocument()
  })
})

describe('what a role is shown', () => {
  /**
   * A viewer's task page is the whole task, and none of it changeable.
   *
   * Disabled rather than hidden here, unlike the "New task" button: the status
   * of a task is information a viewer came to read, and removing the control
   * would remove the answer along with the ability to change it.
   */
  it('leaves a viewer every control disabled', async () => {
    renderWithQuery(view({ id: '42' }), undefined, principal({ role: 'viewer', permissions: ['task:read', 'project:read'] }))
    await screen.findByRole('heading', { name: 'Implementar refresh token' })
    expect(screen.getByRole('button', { name: 'Change status' })).toBeDisabled()
  })

  it('leaves a developer of the Project able to change it', async () => {
    renderWithQuery(view({ id: '42' }))
    await screen.findByRole('heading', { name: 'Implementar refresh token' })
    expect(screen.getByRole('button', { name: 'Change status' })).toBeEnabled()
  })
})
