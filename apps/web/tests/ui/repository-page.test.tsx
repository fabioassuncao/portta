import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { principal, renderWithQuery } from './render.tsx'
import { navigation } from './setup.ts'
import { makeRepository, makeRepositoryGit } from './fixtures.ts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.status = status
    this.hint = hint
  }
}

const repository = vi.fn()
const repositoryGit = vi.fn()
const repositoryCommits = vi.fn()
const repositoryInstructions = vi.fn()
const repositoryEnvironments = vi.fn()
const deleteRepository = vi.fn()
const project = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    repository: (id: string) => repository(id),
    repositoryGit: (id: string) => repositoryGit(id),
    repositoryCommits: (id: string) => repositoryCommits(id),
    repositoryInstructions: (id: string) => repositoryInstructions(id),
    repositoryEnvironments: (id: string) => repositoryEnvironments(id),
    deleteRepository: (id: string) => deleteRepository(id),
    project: (slug: string) => project(slug),
  },
}))

const { RepositoryPageView, resolveRepositoryTab } = await import('@/components/entities/repository-page-view')

/** The page's server half read the repository and the project it belongs to. */
function view(tab: string | null = null, overrides: { repository?: unknown } = {}) {
  return (
    <RepositoryPageView
      slug="shop"
      projectId="1"
      projectName="Shop"
      initialRepository={(overrides.repository ?? makeRepository()) as never}
      tab={tab}
    />
  )
}

beforeEach(() => {
  const git = makeRepositoryGit()
  repository.mockReset().mockResolvedValue(makeRepository())
  repositoryGit.mockReset().mockResolvedValue(git)
  repositoryCommits.mockReset().mockResolvedValue({ commits: git.commits, collectedAt: git.collectedAt, stale: false })
  repositoryInstructions.mockReset().mockResolvedValue({ instructions: git.instructions, collectedAt: git.collectedAt, stale: false })
  repositoryEnvironments.mockReset().mockResolvedValue([{ environment: 'alpha', running: true, serviceCount: 2, runningCount: 2, unhealthyCount: 0, urls: [{ url: 'http://alpha-web.localhost', host: 'alpha-web.localhost', scope: 'local', scheme: 'http' }] }])
  deleteRepository.mockReset().mockResolvedValue({ ok: true, removed: 'r1', note: '' })
  project.mockReset().mockResolvedValue({ slug: 'shop', name: 'Shop', repositories: [], environments: [] })
  navigation.push.mockReset()
})

describe('the Repository page', () => {
  it('resolves its tabs', () => {
    expect(resolveRepositoryTab(null)).toBe('overview')
    expect(resolveRepositoryTab('commits')).toBe('commits')
    expect(resolveRepositoryTab('git')).toBe('overview')
  })

  it('shows what is checked out, the pull requests and the environments', async () => {
    renderWithQuery(view())
    expect(await screen.findByRole('heading', { name: 'api' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'main' })).toHaveAttribute('href', 'https://github.com/acme/api/tree/main')
    expect(screen.getByText('7 uncommitted changes')).toBeInTheDocument()
    expect(screen.getByText('./bin/portta repos scan --path /srv/projects/shop/api')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: '#61 Add invoice totals' })).toHaveAttribute('href', 'https://github.com/acme/api/pull/61')
    expect(screen.getByText('review requested')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'alpha' })).toHaveAttribute('href', '/environments/alpha')
    expect(screen.getByText('AGENTS.md')).toBeInTheDocument()
  })

  it('walks Projects, the project and Repositories in the breadcrumb instead of a back button', async () => {
    renderWithQuery(view())
    await screen.findByRole('heading', { name: 'api' })
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    expect(await within(nav).findByRole('link', { name: 'Shop' })).toHaveAttribute('href', '/projects/shop')
    expect(within(nav).getByRole('link', { name: 'Repositories' })).toHaveAttribute('href', '/projects/shop/repositories')
    expect(within(nav).getByText('api')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: 'Back to the project' })).toBeNull()
  })

  it('lists the recent commits with the sha linked', async () => {
    renderWithQuery(view('commits'))
    expect(await screen.findByText('Add invoice totals')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '9f2c1ab' })).toHaveAttribute('href', 'https://github.com/acme/api/commit/9f2c1abfeed')
    expect(screen.getByText('Start invoices')).toBeInTheDocument()
  })

  it('shows the instruction files and the content of the selected one', async () => {
    renderWithQuery(view('instructions'))
    expect(await screen.findByLabelText('AGENTS.md')).toHaveTextContent('Never prune.')
    expect(screen.getByText('uncommitted')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /style\.mdc/ }))
    expect(await screen.findByText(/over the collection bound/)).toBeInTheDocument()
  })

  it('makes every tab a link under the project', async () => {
    renderWithQuery(view())
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      '/projects/shop/repositories/r1',
      '/projects/shop/repositories/r1/commits',
      '/projects/shop/repositories/r1/instructions',
    ])
  })

  it('says when the host has not scanned it yet', async () => {
    repositoryGit.mockResolvedValue(makeRepositoryGit({ collected: false, git: null, remote: null, forge: null, commits: [], instructions: [] }))
    renderWithQuery(view())
    expect(await screen.findByText(/has not been scanned yet/)).toBeInTheDocument()
  })

  it('unregisters after a confirmation and goes back to the project', async () => {
    renderWithQuery(view())
    await screen.findByRole('heading', { name: 'api' })
    await userEvent.click(screen.getByRole('button', { name: 'Unregister' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unregister' }))
    await waitFor(() => expect(deleteRepository).toHaveBeenCalledWith('r1'))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/projects/shop'))
  })

})

describe('what a role is shown', () => {
  // Unregistering a repository is a write on the Project. A viewer, and a
  // developer who is not in it, are offered nothing to click.
  it('offers no unregister to somebody who may not manage repositories', async () => {
    renderWithQuery(view(), undefined, principal({ role: 'viewer', permissions: ['repository:read'] }))
    await screen.findByRole('heading', { name: 'api' })
    expect(screen.queryByRole('button', { name: 'Unregister' })).not.toBeInTheDocument()
  })
})
