import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeContainer, makeEnvironment, makeOperable, makeStartable } from './fixtures.ts'
import type { Environment } from 'portta-contracts'

const environments = vi.fn()
const projects = vi.fn()
const project = vi.fn()
const containerAction = vi.fn()
const environmentAction = vi.fn()
const serviceAction = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error { status = 0 },
  api: {
    projects: () => projects(),
    project: (slug: string) => project(slug),
    environments: () => environments(),
    containerAction: (...args: unknown[]) => containerAction(...args),
    serviceAction: (...args: unknown[]) => serviceAction(...args),
    environmentAction: (...args: unknown[]) => environmentAction(...args),
    forgetEnvironment: vi.fn().mockResolvedValue({ ok: true, forgotten: 'gamma' }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    removalPreview: vi.fn().mockResolvedValue({ allowed: true, warnings: [], namedVolumes: [] }),
    stats: vi.fn().mockResolvedValue({ cpuPercent: null }),
    shares: vi.fn().mockResolvedValue([]),
    serviceTraefik: vi.fn().mockResolvedValue({ available: false, reason: 'not configured' }),
    environmentGit: vi.fn().mockResolvedValue({ collected: false, git: null, refreshCommand: 'portta repos scan' }),
    metricsCurrent: vi.fn().mockResolvedValue({ projects: [], collectorActive: false, stale: true }),
  },
}))

const { EnvironmentsView: EnvironmentsPage } = await import('../../app/(panel)/environments/environments-view.tsx')

const WEB_URL = { url: 'http://alpha-web.localhost', host: 'alpha-web.localhost', scope: 'local' as const, scheme: 'http' as const }
const API_URLS = [
  { url: 'https://alpha-api.vpn.example.test', host: 'alpha-api.vpn.example.test', scope: 'vpn' as const, scheme: 'https' as const },
  { url: 'http://alpha-api.localhost', host: 'alpha-api.localhost', scope: 'local' as const, scheme: 'http' as const },
]

const alpha: Environment = {
  name: 'alpha', presence: 'live', integrated: true, workingDir: '/srv/dev/alpha',
  operable: makeOperable('/srv/dev/alpha'), startable: makeStartable(),
  namespace: null, group: null, repo: null, repoUrl: null, gitRoot: null,
  serviceCount: 4, runningCount: 4, healthyCount: 2, unhealthyCount: 0,
  networks: ['portta', 'alpha_default'], startedAt: 1_700_000_000, uptimeSeconds: 7200,
  scopes: ['local'], urls: [WEB_URL, ...API_URLS],
  services: [
    makeContainer({ id: 'a-web', name: 'alpha-web-1', environment: 'alpha', service: 'web', ownership: 'integrated', traefikEnabled: true, onGatewayNetwork: true, kind: 'http', exposedPorts: [3000], uptimeSeconds: 7200, urls: [WEB_URL] }),
    makeContainer({ id: 'a-postgres', name: 'alpha-postgres-1', image: 'postgres:18.6-alpine', environment: 'alpha', service: 'postgres', ownership: 'integrated', kind: 'postgres', exposedPorts: [5432] }),
    makeContainer({ id: 'a-redis', name: 'alpha-redis-1', image: 'redis:8.10.1-alpine', environment: 'alpha', service: 'redis', ownership: 'integrated', kind: 'redis', exposedPorts: [6379] }),
    makeContainer({ id: 'a-api', name: 'alpha-api-1', environment: 'alpha', service: 'api', ownership: 'integrated', traefikEnabled: true, onGatewayNetwork: true, kind: 'http', urls: API_URLS }),
  ],
}

const beta: Environment = {
  ...alpha, name: 'beta', namespace: 'beta-issue59', serviceCount: 1, runningCount: 1, unhealthyCount: 1, urls: [],
  services: [makeContainer({ id: 'b-web', name: 'beta-web-1', environment: 'beta', service: 'web', ownership: 'integrated', health: 'unhealthy', traefikEnabled: true, onGatewayNetwork: true, kind: 'http' })],
}

beforeEach(() => {
  environments.mockReset().mockResolvedValue([alpha, beta])
  projects.mockReset().mockResolvedValue([{ slug: 'shop', name: 'Shop' }])
  project.mockReset().mockResolvedValue({ slug: 'shop', name: 'Shop', repositories: [], environments: [{ environment: 'alpha' }] })
  containerAction.mockReset().mockResolvedValue({ ok: true })
  serviceAction.mockReset().mockResolvedValue({ ok: true })
  environmentAction.mockReset()
})

describe('the Environments page', () => {
  it('shows every environment with its services as rows', async () => {
    renderWithQuery(<EnvironmentsPage />)
    await screen.findByText('alpha')
    expect(screen.getByText('4/4 running')).toBeInTheDocument()
    for (const service of ['web', 'postgres', 'redis', 'api']) {
      expect(screen.getAllByRole('row', { name: `${service} service` }).length).toBeGreaterThan(0)
    }
  })

  it('says which project adopted an environment, and when none did', async () => {
    renderWithQuery(<EnvironmentsPage />)
    expect(await screen.findByRole('link', { name: 'Project: Shop' })).toHaveAttribute('href', '/projects/shop')
    expect(screen.getByText('not adopted by any project')).toBeInTheDocument()
  })

  it('filters out adopted environments', async () => {
    renderWithQuery(<EnvironmentsPage />)
    await screen.findByRole('link', { name: 'Project: Shop' })
    await userEvent.selectOptions(screen.getAllByLabelText('Filter environments')[0]!, 'unattributed')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'alpha' })).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'beta' })).toBeInTheDocument()
  })

  it('flags the worktree and the unhealthy service', async () => {
    renderWithQuery(<EnvironmentsPage />)
    expect(await screen.findByText('worktree: beta-issue59')).toBeInTheDocument()
    expect(screen.getByText('1 unhealthy')).toBeInTheDocument()
  })

  it('puts the nearest address in the row and offers it for copying', async () => {
    renderWithQuery(<EnvironmentsPage />)
    const api = await screen.findByRole('row', { name: 'api service' })
    expect(within(api).getByRole('link', { name: 'http://alpha-api.localhost' })).toBeInTheDocument()
    expect(within(api).queryByText('https://alpha-api.vpn.example.test')).not.toBeInTheDocument()
    await userEvent.click(within(api).getByRole('button', { name: 'Copy' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://alpha-api.localhost')
  })

  it('opens every address through the Open / Test menu', async () => {
    renderWithQuery(<EnvironmentsPage />)
    const api = await screen.findByRole('row', { name: 'api service' })
    await userEvent.click(within(api).getByRole('button', { name: 'Open / Test' }))
    expect(await screen.findByRole('menuitem', { name: /alpha-api.vpn.example.test/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /http:\/\/alpha-api.localhost/ })).toBeInTheDocument()
  })

  it('says why an http service has no address, and hides addresses of a stopped one', async () => {
    environments.mockResolvedValue([
      { ...alpha, serviceCount: 1, runningCount: 0, services: [makeContainer({ id: 'a-web', name: 'alpha-web-1', environment: 'alpha', service: 'web', ownership: 'integrated', state: 'exited', kind: 'http', traefikEnabled: true, onGatewayNetwork: true, urls: [WEB_URL] })] },
      beta,
    ])
    renderWithQuery(<EnvironmentsPage />)
    const stopped = (await screen.findAllByRole('row', { name: 'web service' }))[0] as HTMLElement
    expect(within(stopped).getByText('no live address while exited')).toBeInTheDocument()
    expect(within(stopped).queryByText(WEB_URL.url)).not.toBeInTheDocument()
    const broken = screen.getAllByRole('row', { name: 'web service' })[1] as HTMLElement
    expect(within(broken).getByText('routing enabled, no hostname discovered')).toBeInTheDocument()
  })

  it('keeps runtime, uptime and actions in the row', async () => {
    renderWithQuery(<EnvironmentsPage />)
    const web = (await screen.findAllByRole('row', { name: 'web service' }))[0] as HTMLElement
    expect(web).toHaveTextContent('nginx:1.31.4-alpine')
    expect(web).toHaveTextContent('2h 0m')
    expect(within(web).getByRole('button', { name: 'Open web' })).toBeInTheDocument()
    expect(within(web).getByRole('button', { name: 'Actions for web' })).toBeInTheDocument()
  })

  it('sends a service action through the service route', async () => {
    renderWithQuery(<EnvironmentsPage />)
    const web = (await screen.findAllByRole('row', { name: 'web service' }))[0] as HTMLElement
    await userEvent.click(within(web).getByRole('button', { name: 'Actions for web' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Restart' }))
    await waitFor(() => expect(serviceAction).toHaveBeenCalledWith('alpha', 'web', 'restart'))
    expect(containerAction).not.toHaveBeenCalled()
  })

  it('restarts an environment as one action', async () => {
    environmentAction.mockResolvedValue({ ok: true, project: 'alpha', action: 'restart', requested: 4, succeeded: 4, failed: 0, skipped: 0, results: [] })
    renderWithQuery(<EnvironmentsPage />)
    await screen.findByText('alpha')
    await userEvent.click(screen.getAllByRole('button', { name: 'Restart' })[0] as HTMLElement)
    await waitFor(() => expect(environmentAction).toHaveBeenCalledWith('alpha', 'restart'))
  })

  it('links the environment heading to its page', async () => {
    renderWithQuery(<EnvironmentsPage />)
    expect(await screen.findByRole('link', { name: 'alpha' })).toHaveAttribute('href', '/environments/alpha')
  })

  it('explains how to adopt an environment when there is none', async () => {
    environments.mockResolvedValue([])
    renderWithQuery(<EnvironmentsPage />)
    expect(await screen.findByText('No environment is running')).toBeInTheDocument()
    expect(screen.getByText(/Adopt it onto a Project/)).toBeInTheDocument()
  })

  it('lists a remembered environment as not running, after the live ones, with Start and Forget', async () => {
    const gamma = makeEnvironment({ name: 'gamma', presence: 'remembered', workingDir: '/srv/dev/gamma' })
    environments.mockResolvedValue([gamma, alpha, beta])
    renderWithQuery(<EnvironmentsPage />)
    await screen.findByRole('link', { name: 'gamma' })
    const headings = screen.getAllByRole('link', { name: /^(alpha|beta|gamma)$/ }).map((link) => link.textContent)
    expect(headings).toEqual(['alpha', 'beta', 'gamma'])
    expect(screen.getByText('Not running', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('0/0 running')).toBeNull()
    expect(screen.getByText('Containers were removed. Start recreates them through the runner.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Forget' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(2)
  })

  it('filters down to the remembered ones', async () => {
    environments.mockResolvedValue([alpha, beta, makeEnvironment({ name: 'gamma', presence: 'remembered' })])
    renderWithQuery(<EnvironmentsPage />)
    await screen.findByRole('link', { name: 'gamma' })
    await userEvent.selectOptions(screen.getAllByLabelText('Filter environments')[0]!, 'remembered')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'alpha' })).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'gamma' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getAllByLabelText('Filter environments')[0]!, 'running')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'gamma' })).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'alpha' })).toBeInTheDocument()
  })
})
