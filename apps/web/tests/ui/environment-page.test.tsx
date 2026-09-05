import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { principal, renderWithQuery } from './render.tsx'
import { navigation } from './setup.ts'
import { makeContainer, makeEnvironment, makeOperable, makeStartable } from './fixtures.ts'
import type { Environment, ProjectGit } from 'portta-contracts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.hint = hint
  }
}

const project = vi.fn()
const environmentGit = vi.fn()
const environmentLogs = vi.fn()
const environmentServices = vi.fn()
const projects = vi.fn()
const projectDetail = vi.fn()
const forgetEnvironment = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    environment: (name: string) => project(name),
    environmentGit: (name: string) => environmentGit(name),
    environmentLogs: (name: string, options: unknown) => environmentLogs(name, options),
    containerAction: vi.fn().mockResolvedValue({ ok: true }),
    environmentAction: vi.fn().mockResolvedValue({ ok: true, project: 'alpha', action: 'restart', requested: 0, succeeded: 0, failed: 0, skipped: 0, results: [] }),
    forgetEnvironment: (name: string) => forgetEnvironment(name),
    logs: vi.fn().mockResolvedValue({ lines: [], truncated: false }),
    removalPreview: vi.fn().mockResolvedValue({ allowed: true, warnings: [], namedVolumes: [] }),
    stats: vi.fn().mockResolvedValue({ cpuPercent: null }),
    shares: vi.fn().mockResolvedValue({ shares: [] }),
    serviceTraefik: vi.fn().mockResolvedValue({ available: false, reason: 'not configured' }),
    environmentServices: (name: string) => environmentServices(name),
    serviceAction: vi.fn().mockResolvedValue({ ok: true }),
    environmentSettings: vi.fn().mockResolvedValue({}),
    projects: () => projects(),
    project: (slug: string) => projectDetail(slug),
    metricsCurrent: vi.fn().mockResolvedValue({ projects: [], collectorActive: false, stale: true }),
  },
}))

const { EnvironmentShell, resolveTab } = await import('@/components/environments/environment-shell')
const { EnvironmentOverview } = await import('@/components/environments/environment-overview')
const { LogsView } = await import('../../app/(panel)/environments/[name]/logs/logs-view.tsx')
const { EnvironmentSettingsView } = await import('../../app/(panel)/environments/[name]/settings/settings-view.tsx')

/**
 * A tab is a route now, so the test renders the shell around the body the route
 * would have rendered, and says which path it is on.
 */
function page(name: string, tab: 'overview' | 'logs' | 'settings' = 'overview', service: string | null = null) {
  navigation.pathname = tab === 'overview'
    ? `/environments/${name}`
    : `/environments/${name}/${tab}`
  navigation.search = service ? `service=${service}` : ''
  return (
    <EnvironmentShell name={name}>
      {tab === 'overview' ? <EnvironmentOverview name={name} /> : null}
      {tab === 'logs' ? <LogsView name={name} /> : null}
      {tab === 'settings' ? <EnvironmentSettingsView name={name} /> : null}
    </EnvironmentShell>
  )
}

const WEB_URL = {
  url: 'http://alpha-web.localhost',
  host: 'alpha-web.localhost',
  scope: 'local' as const,
  scheme: 'http' as const,
}

const alpha: Environment = {
  name: 'alpha',
  presence: 'live',
  integrated: true,
  workingDir: '/srv/dev/alpha',
  operable: makeOperable('/srv/dev/alpha'),
  startable: makeStartable(),
  namespace: null,
  group: null,
  repo: null,
  repoUrl: null,
  gitRoot: null,
  serviceCount: 2,
  runningCount: 2,
  healthyCount: 1,
  unhealthyCount: 0,
  networks: ['portta', 'alpha_default'],
  startedAt: 1_700_000_000,
  uptimeSeconds: 7200,
  scopes: ['local'],
  urls: [WEB_URL],
  services: [
    makeContainer({
      id: 'a-web', name: 'alpha-web-1', environment: 'alpha', service: 'web',
      ownership: 'integrated', traefikEnabled: true, kind: 'http',
      exposedPorts: [3000], uptimeSeconds: 7200, urls: [WEB_URL],
      mounts: [{ type: 'bind', name: null, source: '/srv/dev/alpha', destination: '/app', rw: true }],
      restartCount: 4,
    }),
    makeContainer({
      id: 'a-postgres', name: 'alpha-postgres-1', image: 'postgres:18.6-alpine',
      environment: 'alpha', service: 'postgres', ownership: 'integrated', kind: 'postgres',
      exposedPorts: [5432],
    }),
  ],
}

const gitScan: ProjectGit = {
  project: 'alpha',
  collected: true,
  collectedAt: 1_700_000_000,
  ageSeconds: 10,
  stale: false,
  staleAfterSeconds: 900,
  workingDir: '/srv/dev/alpha',
  git: {
    branch: 'fix/182-tcp-proxy',
    detached: false,
    head: { sha: 'abc1234def', shortSha: 'abc1234', subject: 'Fix the proxy', author: 'Someone', date: 1_700_000_000 },
    staged: 1, unstaged: 2, untracked: 0, unmerged: 0, dirty: true,
    upstream: 'origin/fix/182-tcp-proxy', ahead: 3, behind: 0, remote: 'origin',
  },
  remote: {
    url: 'git@github.com:acme/alpha.git', host: 'github.com',
    slug: 'acme/alpha', kind: 'github', repoUrl: 'https://github.com/acme/alpha',
  },
  links: {
    repo: 'https://github.com/acme/alpha',
    commit: 'https://github.com/acme/alpha/commit/abc1234def',
    branch: 'https://github.com/acme/alpha/tree/fix/182-tcp-proxy',
  },
  forge: {
    kind: 'github',
    collectedAt: 1_700_000_000,
    authenticated: true,
    reason: null,
    // Five, so the card's slice(0, 4) would have hidden one.
    pulls: [1, 2, 3, 4, 5].map((number) => ({
      number,
      title: `Pull ${number}`,
      state: 'OPEN',
      draft: false,
      reviewDecision: null,
      checks: null,
      url: `https://github.com/acme/alpha/pull/${number}`,
      headRefName: `feat/${number}`,
    })),
  },
  reason: null,
  refreshCommand: 'portta repos scan --environment alpha',
}

beforeEach(() => {
  project.mockReset().mockResolvedValue(alpha)
  environmentGit.mockReset().mockResolvedValue(gitScan)
  environmentLogs.mockReset().mockResolvedValue({
    project: 'alpha',
    truncated: false,
    ordered: true,
    sources: [
      { containerId: 'a-web', service: 'web', name: 'alpha-web-1', state: 'running', lineCount: 1, truncated: false, error: null },
      { containerId: 'a-postgres', service: 'postgres', name: 'alpha-postgres-1', state: 'running', lineCount: 1, truncated: false, error: null },
    ],
    lines: [
      { stream: 'stdout', timestamp: '2026-01-01T10:00:01Z', text: 'web up', service: 'web' },
      { stream: 'stdout', timestamp: '2026-01-01T10:00:02Z', text: 'postgres ready', service: 'postgres' },
    ],
  })
  environmentServices.mockReset().mockRejectedValue(new ApiError(404, 'not found'))
  forgetEnvironment.mockReset().mockResolvedValue({ ok: true, forgotten: 'alpha' })
  projects.mockReset().mockResolvedValue([{ slug: 'shop', name: 'Shop' }])
  projectDetail.mockReset().mockResolvedValue({ slug: 'shop', name: 'Shop', repositories: [{ id: 'r1', name: 'api', environments: ['alpha'] }], environments: [{ environment: 'alpha' }] })
  navigation.push.mockReset()
  navigation.pathname = '/environments/alpha'
  navigation.search = ''
})

describe('resolveTab', () => {
  it('falls back to Overview for an unknown tab, and for the tabs that no longer exist', () => {
    expect(resolveTab(null)).toBe('overview')
    expect(resolveTab('nope')).toBe('overview')
    expect(resolveTab('git')).toBe('overview')
    expect(resolveTab('settings')).toBe('settings')
  })
})

describe('Environment page', () => {
  it('fetches one environment instead of the whole list', async () => {
    renderWithQuery(page('alpha'))
    await screen.findByRole('heading', { name: 'alpha' })
    expect(project).toHaveBeenCalledWith('alpha')
  })

  it('shows the services as one table, from the containers when the panel does not serve rows yet', async () => {
    renderWithQuery(page('alpha', 'overview'))
    expect(await screen.findByRole('row', { name: 'web service' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: 'postgres service' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'http://alpha-web.localhost' })).toBeInTheDocument()
    expect(screen.getByText('4 restarts')).toBeInTheDocument()
    expect(await screen.findByText(/showing what the containers report/)).toBeInTheDocument()
  })

  it('prefers the measured rows when the panel serves them', async () => {
    environmentServices.mockResolvedValue({
      environment: 'alpha',
      services: [{
        name: 'web', environment: 'alpha', containerId: 'a-web', containerName: 'alpha-web-1', image: 'nginx:1.31.4-alpine', kind: 'http',
        tech: { id: 'nginx', label: 'nginx' }, state: 'running', health: 'healthy', startedAt: 1, uptimeSeconds: 7200, restartCount: 0, exitCode: null,
        ports: [], exposedPorts: [3000], networks: [], onGatewayNetwork: true,
        access: { kind: 'http', primary: { provider: 'local', url: 'http://alpha-web.localhost', scope: 'local', usable: true, shareable: false, problem: null }, endpoints: [], bridge: null, routed: true, problem: null },
        resources: { cpuUtilisation: 0.08, memoryUsedBytes: 314572800, memoryLimitBytes: null, diskBytes: null, collectedAt: 1, stale: false },
        actions: { start: false, stop: true, restart: true, logs: true, openAccess: false, share: true }, hidden: false,
      }],
      resources: { cpuUtilisation: 0.12, memoryUsedBytes: 419430400, memoryLimitBytes: null, diskBytes: null, collectedAt: 1, stale: false },
    })
    renderWithQuery(page('alpha', 'overview'))
    await screen.findByText(/CPU 8%/)
    const web = screen.getByRole('row', { name: 'web service' })
    expect(web).toHaveTextContent('CPU 8%')
    expect(web).toHaveTextContent('300 MB')
    expect(screen.queryByText(/showing what the containers report/)).not.toBeInTheDocument()
  })

  it('opens the drawer for the service the URL names, with its mounts', async () => {
    renderWithQuery(page('alpha', 'overview', 'web'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/bind: \/srv\/dev\/alpha → \/app/)).toBeInTheDocument()
  })

  it('carries the branch in the header and links the repository', async () => {
    renderWithQuery(page('alpha', 'overview'))
    expect(await screen.findByText('fix/182-tcp-proxy')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Open repository: api' })).toHaveAttribute('href', '/projects/shop/repositories/r1')
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    expect(within(nav).getByRole('link', { name: 'Shop' })).toHaveAttribute('href', '/projects/shop')
    expect(within(nav).getByRole('link', { name: 'Environments' })).toHaveAttribute('href', '/projects/shop/environments')
    expect(within(nav).getByText('alpha')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: 'Environments' })).toBeNull()
  })

  it('sits under all environments when no Project owns it', async () => {
    projectDetail.mockResolvedValue({ slug: 'shop', name: 'Shop', repositories: [], environments: [] })
    renderWithQuery(page('alpha', 'overview'))
    await screen.findByRole('heading', { name: 'alpha' })
    expect(await screen.findByText('not adopted by any project')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Environments' })).toHaveAttribute('href', '/environments')
    expect(within(nav).queryByRole('link', { name: 'Projects' })).toBeNull()
    expect(within(nav).getByText('alpha')).toHaveAttribute('aria-current', 'page')
  })




  it('reports an environment that stopped existing with a way back to the list', async () => {
    project.mockRejectedValue(new ApiError(404, "no project 'ghost' is running"))
    renderWithQuery(page('ghost'))
    expect(await screen.findByText("No environment 'ghost' is running")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to all projects' })).toHaveAttribute('href', '/environments')
  })

  it('renders an empty state for an environment with no services', async () => {
    project.mockResolvedValue({ ...alpha, services: [], serviceCount: 0, runningCount: 0 })
    renderWithQuery(page('alpha', 'overview'))
    expect(await screen.findByText('This environment has no services')).toBeInTheDocument()
  })

  it('reads every service of the environment on the Logs tab', async () => {
    renderWithQuery(page('alpha', 'logs'))
    expect(await screen.findByText('web up')).toBeInTheDocument()
    expect(screen.getByText('postgres ready')).toBeInTheDocument()
    expect(environmentLogs).toHaveBeenCalledWith('alpha', { tail: 200, service: null })
    expect(screen.getByLabelText('Service')).toHaveValue('')
  })

  it('reads one service when the URL names it', async () => {
    renderWithQuery(page('alpha', 'logs', 'postgres'))
    await screen.findByText('postgres ready')
    expect(environmentLogs).toHaveBeenCalledWith('alpha', { tail: 200, service: 'postgres' })
    expect(screen.getByLabelText('Service')).toHaveValue('postgres')
  })

  it('shows the settings form on its own tab', async () => {
    renderWithQuery(page('alpha', 'settings'))
    expect(await screen.findByLabelText('Display name')).toBeInTheDocument()
  })

  it('shows the task this environment is running for, and why', async () => {
    project.mockResolvedValue({
      ...alpha,
      task: {
        id: '42', project: 'shop', title: 'Proxy TCP perde conexão', status: 'in_progress', priority: 'high',
        assignee: null, agent: 'claude-code', source: 'branch', reason: 'this environment is on branch fix/182-tcp-proxy',
        panelUrl: '/projects/shop/tasks/42', github: { repository: 'acme/alpha', number: 182, htmlUrl: 'https://github.com/acme/alpha/issues/182' },
      },
    })
    renderWithQuery(page('alpha', 'overview'))
    expect(await screen.findByRole('link', { name: '#42 Proxy TCP perde conexão' })).toHaveAttribute('href', '/projects/shop/tasks/42')
    expect(screen.getByText('this environment is on branch fix/182-tcp-proxy')).toBeInTheDocument()
    expect(screen.getByText('claude-code')).toBeInTheDocument()
  })

  it('still shows a bound issue when the panel only knows the issue', async () => {
    project.mockResolvedValue({
      ...alpha,
      issue: {
        id: '1', repository: 'acme/alpha', number: 182, title: 'Proxy TCP perde conexão',
        state: 'open', issueType: 'Bug', status: 'in_progress', priority: 'high',
        source: 'branch', reason: 'this environment is on branch fix/182-tcp-proxy',
        htmlUrl: 'https://github.com/acme/alpha/issues/182',
        panelUrl: '#/issues/1', syncedAt: 1_700_000_000,
      },
    })
    renderWithQuery(page('alpha', 'overview'))
    expect(await screen.findByRole('link', { name: '#182' })).toHaveAttribute('href', 'https://github.com/acme/alpha/issues/182')
  })


  it('makes every tab a link that survives a reload', async () => {
    renderWithQuery(page('alpha', 'overview'))
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      '/environments/alpha',
      '/environments/alpha/logs',
      '/environments/alpha/settings',
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('navigates to the next tab with the arrow keys', async () => {
    renderWithQuery(page('alpha', 'overview'))
    const list = await screen.findByRole('tablist')
    within(list).getAllByRole('tab')[0]!.focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/environments/alpha/logs'))
  })

  describe('when remembered', () => {
    const remembered = makeEnvironment({ presence: 'remembered', workingDir: '/srv/dev/alpha' })

    beforeEach(() => {
      project.mockResolvedValue(remembered)
      environmentGit.mockRejectedValue(new ApiError(404, 'no scan'))
    })

    it('says it is not running and hides rebuild and remove', async () => {
      renderWithQuery(page('alpha', 'overview'))
      await screen.findByRole('heading', { name: 'alpha' })
      expect(screen.getByText('Not running')).toBeInTheDocument()
      expect(screen.queryByText(/services running/)).toBeNull()
      expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Forget' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Rebuild' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Remove, keep data' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Open / Test' })).toBeNull()
      expect(await screen.findByText('Containers were removed. Start recreates them through the runner.')).toBeInTheDocument()
    })

    it('does not read logs that no container can write', async () => {
      renderWithQuery(page('alpha', 'logs'))
      expect(await screen.findByText('Containers were removed. Start recreates them through the runner.')).toBeInTheDocument()
      expect(environmentLogs).not.toHaveBeenCalled()
    })

    it('goes back to the list once forgotten', async () => {
      renderWithQuery(page('alpha', 'overview'))
      await userEvent.click(await screen.findByRole('button', { name: 'Forget' }))
      await screen.findByRole('dialog', { name: 'Forget this environment?' })
      await userEvent.click(screen.getAllByRole('button', { name: 'Forget' }).at(-1)!)
      await waitFor(() => expect(forgetEnvironment).toHaveBeenCalledWith('alpha'))
      await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/environments'))
    })
  })
})

describe('what a role is shown', () => {
  const viewer = principal({ role: 'viewer', permissions: ['environment:read', 'service:read', 'logs:read'] })

  // A viewer reads. Nothing on the page offers to start, stop or forget
  // anything, and the page itself still answers.
  it('offers a viewer no operation and no way to forget', async () => {
    renderWithQuery(page('alpha', 'overview'), undefined, viewer)
    await screen.findByRole('heading', { name: 'alpha' })
    expect(screen.queryByRole('button', { name: 'Forget' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  it('still reads the logs, which is a permission of its own', async () => {
    renderWithQuery(page('alpha', 'logs'), undefined, viewer)
    expect(await screen.findByText('web up')).toBeInTheDocument()
  })

  it('offers a developer the operations', async () => {
    const developer = principal({ role: 'developer', permissions: ['environment:read', 'environment:operate', 'service:read'] })
    renderWithQuery(page('alpha', 'overview'), undefined, developer)
    await screen.findByRole('heading', { name: 'alpha' })
    expect(screen.queryByRole('button', { name: 'Forget' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })
})
