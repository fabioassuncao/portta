import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { principal, renderWithQuery } from './render.tsx'
import { navigation } from './setup.ts'
import { makeTask, makeTaskSummary } from './fixtures.ts'
import type { ProjectSummary } from 'portta-contracts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.status = status
    this.hint = hint
  }
}

const allTasks = vi.fn()
const projects = vi.fn()
const project = vi.fn()
const createTask = vi.fn()
const moveTask = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    allTasks: (filters: unknown) => allTasks(filters),
    projects: () => projects(),
    project: (slug: string) => project(slug),
    createTask: (slug: string, body: unknown) => createTask(slug, body),
    moveTask: (id: string, body: unknown) => moveTask(id, body),
  },
}))

const { TasksPageView } = await import('../../app/(panel)/tasks/tasks-page-view.tsx')

/** The page's server half read these; the view takes them as given. */
function view() {
  return <TasksPageView initialProjects={catalog} initialTasks={[]} />
}

const catalog: ProjectSummary[] = [
  {
    id: '1',
    slug: 'portta',
    name: 'Portta',
    description: null,
    archived: false,
    relativePath: null,
    location: 'managed',
    repositoryCount: 1,
    environmentCount: 1,
    runningEnvironmentCount: 1,
    environments: [{ name: 'portta', running: true, serviceCount: 1, runningCount: 1, unhealthyCount: 0 }],
  },
  {
    id: '2',
    slug: 'shop',
    name: 'Demo Shop',
    description: null,
    archived: false,
    relativePath: null,
    location: 'external',
    repositoryCount: 1,
    environmentCount: 0,
    runningEnvironmentCount: 0,
    environments: [],
  },
]

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  navigation.push.mockReset()
  navigation.search = ''
  allTasks.mockReset().mockResolvedValue([
    makeTaskSummary({ id: '10', project: 'portta', title: 'Fix gateway', status: 'in_progress' }),
    makeTaskSummary({ id: '11', project: 'shop', title: 'Add cart', status: 'ready' }),
  ])
  projects.mockReset().mockResolvedValue(catalog)
  project.mockReset().mockResolvedValue({
    id: '1',
    slug: 'portta',
    name: 'Portta',
    description: null,
    archived: false,
    relativePath: null,
    resolvedPath: null,
    location: 'managed',
    repositories: [],
    githubRepositories: [],
    environments: [],
  })
  createTask.mockReset().mockResolvedValue(makeTask({ id: '99', project: 'portta', draft: true, title: 'New task' }))
  moveTask.mockReset().mockResolvedValue({})
})

describe('the global tasks page', () => {
  it('keeps the view switcher with the list, not beside the page verb', async () => {
    renderWithQuery(view())
    await screen.findByRole('article', { name: '#10 Fix gateway' })
    const views = screen.getByRole('radiogroup', { name: 'View' })
    expect(within(views).getByRole('radio', { name: 'Board' })).toHaveAttribute('aria-checked', 'true')
    expect(within(views).queryByRole('button', { name: 'New task' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument()
  })

  it('keeps the toolbar above the table, with the column menu beside it', async () => {
    navigation.search = 'view=table'
    renderWithQuery(view())
    const table = (await screen.findByRole('table')).closest('[data-slot="data-table"]')
    expect(table).not.toBeNull()
    const views = screen.getByRole('radiogroup', { name: 'View' })
    expect(within(views).getByRole('radio', { name: 'Table' })).toHaveAttribute('aria-checked', 'true')
    expect(table).not.toContainElement(views)
    expect(table).not.toContainElement(screen.getByLabelText('Project'))
    const columns = screen.getByRole('button', { name: 'Columns' })
    expect(table).not.toContainElement(columns)
    expect(views.parentElement).toContainElement(columns)
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument()
  })

  it('hides a column from the toolbar menu and remembers it', async () => {
    navigation.search = 'view=table'
    renderWithQuery(view())
    await screen.findByRole('table')
    expect(screen.getByRole('columnheader', { name: /Type/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Type' }))
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: /Type/ })).not.toBeInTheDocument())
    expect(localStorage.getItem('portta-table:tasks-all')).toContain('"type"')
  })

  it('shows tasks from every project and names the project on each card', async () => {
    renderWithQuery(view())
    expect(await screen.findByRole('article', { name: '#10 Fix gateway' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: '#11 Add cart' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Portta' })).toHaveAttribute('href', '/projects/portta')
    expect(screen.getByRole('link', { name: 'Demo Shop' })).toHaveAttribute('href', '/projects/shop')
    expect(screen.getByRole('link', { name: 'Fix gateway' })).toHaveAttribute('href', '/projects/portta/tasks/10?from=tasks')
  })

  it('keeps a project filter in the URL', async () => {
    renderWithQuery(view())
    await screen.findByRole('article', { name: '#10 Fix gateway' })
    await userEvent.selectOptions(screen.getByLabelText('Project'), 'portta')
    expect(navigation.push).toHaveBeenCalledWith('/tasks?project=portta')
  })

  it('asks which project a new task belongs to, then opens it', async () => {
    navigation.search = 'project=portta'
    renderWithQuery(view())
    await screen.findByRole('heading', { name: 'Tasks' })
    await userEvent.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose a project' })
    expect(within(dialog).getByLabelText('Project')).toHaveValue('portta')
    await userEvent.click(within(dialog).getByRole('button', { name: 'New task' }))
    await waitFor(() => expect(createTask).toHaveBeenCalledWith('portta', expect.objectContaining({ draft: true })))
    expect(navigation.push).toHaveBeenCalledWith('/projects/portta/tasks/99?from=tasks')
  })
})

describe('what a role is shown', () => {
  it('offers no new task to somebody who may not write one', async () => {
    renderWithQuery(view(), undefined, principal({ role: 'viewer', permissions: ['task:read', 'project:read'] }))
    await screen.findByRole('article', { name: '#10 Fix gateway' })
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument()
  })
})
