import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { principal, renderWithQuery } from './render.tsx'
import { navigation } from './setup.ts'
import { makeOverview, makePulse } from './fixtures.ts'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const projects = vi.fn()
const environments = vi.fn()
const developmentOverview = vi.fn()
const environmentAction = vi.fn()
const patchProject = vi.fn()
const deleteProject = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    projects: () => projects(),
    environments: () => environments(),
    developmentOverview: () => developmentOverview(),
    environmentAction: (...args: unknown[]) => environmentAction(...args),
    patchProject: (...args: unknown[]) => patchProject(...args),
    deleteProject: (...args: unknown[]) => deleteProject(...args),
  },
}))

const { ProjectsView } = await import('../../app/(panel)/projects/projects-view.tsx')

/** The page's server half already read these; the view takes them as given. */
function view(overrides: { projects?: unknown[]; overview?: unknown } = {}) {
  return (
    <ProjectsView
      initialProjects={(overrides.projects ?? []) as never}
      initialOverview={(overrides.overview ?? makeOverview({ projects: [] })) as never}
    />
  )
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-1',
    slug: 'produto',
    name: 'Meu Produto',
    description: 'The thing we sell',
    archived: false,
    relativePath: null,
    location: 'external',
    repositoryCount: 2,
    environmentCount: 1,
    runningEnvironmentCount: 1,
    environments: [{ name: 'produto', running: true, serviceCount: 5, runningCount: 5, unhealthyCount: 0 }],
    ...overrides,
  }
}

const idle = summary({
  id: 'ws-2',
  slug: 'loja',
  name: 'Loja',
  description: null,
  runningEnvironmentCount: 0,
  environments: [{ name: 'loja', running: false, serviceCount: 2, runningCount: 0, unhealthyCount: 0 }],
})

beforeEach(() => {
  projects.mockReset().mockResolvedValue([summary()])
  environments.mockReset().mockResolvedValue([{ name: 'alpha' }, { name: 'beta' }])
  developmentOverview.mockReset().mockResolvedValue(makeOverview({ projects: [makePulse()] }))
  environmentAction.mockReset().mockResolvedValue({ ok: true })
  patchProject.mockReset().mockResolvedValue({})
  deleteProject.mockReset().mockResolvedValue({ ok: true, removed: 'produto', note: 'the grouping only' })
  localStorage.clear()
  navigation.push.mockReset()
})

describe('the Projects page', () => {
  it('is the catalog with a pulse per product, and points at the environments as a count', async () => {
    renderWithQuery(view())
    expect(await screen.findByRole('link', { name: 'Meu Produto' })).toHaveAttribute('href', '/projects/produto')
    expect(await screen.findByText('3 open · 1 in progress')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Environments on this host (2)' })).toHaveAttribute('href', '/environments')
  })

  it('still lists what a project owns when the dashboard is unavailable', async () => {
    developmentOverview.mockRejectedValue(new ApiError(503, 'unavailable'))
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    // Counts the catalog knows survive; the ones only the dashboard has do not.
    expect(screen.getByLabelText('2 repositories')).toBeInTheDocument()
    expect(screen.getByLabelText('1/1 running')).toBeInTheDocument()
  })

  it('offers a card the action its state allows, and not the other one', async () => {
    projects.mockResolvedValue([summary(), idle])
    developmentOverview.mockResolvedValue(makeOverview({ projects: [] }))
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    expect(screen.getByRole('button', { name: 'Stop environments Meu Produto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start environments Loja' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start environments Meu Produto' })).not.toBeInTheDocument()
  })

  it('states what stopping a project would interrupt before it does it', async () => {
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('button', { name: 'Stop environments Meu Produto' }))
    expect(await screen.findByText('Stop Meu Produto?')).toBeInTheDocument()
    expect(screen.getByText('This interrupts 5 containers across 1 environments.')).toBeInTheDocument()
    expect(environmentAction).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Stop environments' }))
    expect(environmentAction).toHaveBeenCalledWith('produto', 'stop')
  })

  it('keeps the toolbar in one place above the list, whichever view is on', async () => {
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    const views = screen.getByRole('radiogroup', { name: 'View' })
    expect(within(views).getByRole('radio', { name: 'Cards' })).toHaveAttribute('aria-checked', 'true')
    expect(within(views).queryByRole('button', { name: 'New project' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument()
    // The column menu belongs to a table; on cards there is none to offer.
    expect(screen.queryByRole('button', { name: 'Columns' })).not.toBeInTheDocument()

    await userEvent.click(within(views).getByRole('radio', { name: 'Table' }))
    const table = (await screen.findByRole('table')).closest('[data-slot="data-table"]')
    expect(table).not.toBeNull()
    // The same row, outside the table: the switcher, the filters, and now the column menu.
    const switcher = screen.getByRole('radiogroup', { name: 'View' })
    expect(within(switcher).getByRole('radio', { name: 'Table' })).toHaveAttribute('aria-checked', 'true')
    expect(table).not.toContainElement(switcher)
    expect(table).not.toContainElement(screen.getByLabelText('Search projects'))
    const columns = screen.getByRole('button', { name: 'Columns' })
    expect(table).not.toContainElement(columns)
    expect(switcher.parentElement).toContainElement(columns)
  })

  it('switches to a real table and remembers it', async () => {
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('radio', { name: 'Table' }))
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: /Project/ })).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: 'Meu Produto' })).toBeInTheDocument()
    expect(localStorage.getItem('portta-projects-view')).toBe('table')
  })

  it('sorts the table by a column and remembers the arrangement', async () => {
    projects.mockResolvedValue([summary(), idle])
    developmentOverview.mockResolvedValue(makeOverview({ projects: [] }))
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('radio', { name: 'Table' }))
    await userEvent.click(await screen.findByRole('button', { name: /Project/ }))
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByRole('link', { name: 'Loja' })).toBeInTheDocument()
    expect(localStorage.getItem('portta-table:projects')).toContain('"columnId":"name"')
  })

  it('narrows the list by state, in either view', async () => {
    projects.mockResolvedValue([summary(), idle])
    developmentOverview.mockResolvedValue(makeOverview({ projects: [] }))
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Loja' })
    await userEvent.selectOptions(screen.getByLabelText('State'), 'idle')
    expect(screen.queryByRole('link', { name: 'Meu Produto' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Loja' })).toBeInTheDocument()
  })

  it('hides archived projects until asked for them', async () => {
    projects.mockResolvedValue([summary(), summary({ id: 'ws-3', slug: 'antigo', name: 'Antigo', archived: true })])
    developmentOverview.mockResolvedValue(makeOverview({ projects: [] }))
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    expect(screen.queryByRole('link', { name: 'Antigo' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Show archived'))
    expect(await screen.findByRole('link', { name: 'Antigo' })).toBeInTheDocument()
  })

  it('acts on several projects at once, after saying what it will interrupt', async () => {
    projects.mockResolvedValue([summary(), idle])
    developmentOverview.mockResolvedValue(makeOverview({ projects: [] }))
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('radio', { name: 'Table' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select every row' }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    // Only the project with something running is named, and only its containers counted.
    expect(await screen.findByText('This interrupts 5 containers.')).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop' }))
    expect(environmentAction).toHaveBeenCalledWith('produto', 'stop')
    expect(environmentAction).not.toHaveBeenCalledWith('loja', 'stop')
  })

  it('will not delete a project until its slug is typed', async () => {
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Meu Produto' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete project' }))

    const confirm = await screen.findByRole('button', { name: 'Delete project' })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Type produto to confirm'), 'produto')
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    expect(deleteProject).toHaveBeenCalledWith('produto')
  })
})

describe('what a role is shown', () => {
  // Hidden rather than disabled: a control that is never available to this role
  // is noise, not a hint. The API refuses it either way.
  it('offers no way to create a Project to somebody who may not', async () => {
    renderWithQuery(view(), undefined, principal({ role: 'developer', permissions: ['project:read'] }))
    await screen.findByRole('link', { name: 'Meu Produto' })
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument()
  })

  it('offers it to somebody who may', async () => {
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument()
  })
})
