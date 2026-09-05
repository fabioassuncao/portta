import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import { makeOverview } from './fixtures.ts'
import { emptySnapshot } from 'portta-core'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.status = status
    this.hint = hint
  }
}

const developmentOverview = vi.fn()
const overview = vi.fn()
const metricsCurrent = vi.fn()
const metricsHistory = vi.fn()
const environments = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError,
  api: {
    developmentOverview: () => developmentOverview(),
    overview: () => overview(),
    metricsCurrent: () => metricsCurrent(),
    metricsHistory: () => metricsHistory(),
    environments: () => environments(),
  },
}))

const { OverviewView: Overview } = await import('@/components/overview/overview-view')

beforeEach(() => {
  developmentOverview.mockReset().mockResolvedValue(makeOverview())
  overview.mockReset().mockResolvedValue({ gateway: { up: true, panel: { readOnly: false, docs: true } }, problems: [{ id: 'p', status: 'warn', title: 'Unhealthy containers', detail: 'x', fix: null }], counts: {}, urls: [] })
  metricsCurrent.mockReset().mockResolvedValue({ version: 1, instance: { id: 'i', name: 'lab', hostname: 'lab' }, collectedAt: null, ageSeconds: null, stale: true, collectorActive: false, host: null, runtime: null, projects: [] })
  metricsHistory.mockReset().mockResolvedValue({ windowSeconds: 1800, points: [] })
  environments.mockReset().mockResolvedValue([])
})

describe('the development dashboard', () => {
  it('answers what is being worked on and by whom', async () => {
    renderWithQuery(<Overview />)
    expect(await screen.findByText('3 open · 1 in progress · 0 in review · 1 blocked')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '#42 Implementar refresh token' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '#7 Corrigir fila' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'claude session' })).toBeInTheDocument()
  })

  it('says what needs attention and links to it', async () => {
    renderWithQuery(<Overview />)
    expect(await screen.findByRole('link', { name: 'produto/worker is unhealthy' })).toHaveAttribute('href', '/environments/produto?service=worker')
  })

  it('summarises each project and the code that moved', async () => {
    renderWithQuery(<Overview />)
    const project = await screen.findByRole('group', { name: 'Meu Produto' })
    expect(within(project).getByText('3 open · 1 in progress')).toBeInTheDocument()
    expect(within(project).getByLabelText('1 blocked')).toBeInTheDocument()
    expect(screen.getByText('Add totals')).toBeInTheDocument()
    expect(screen.getByText('3 uncommitted')).toBeInTheDocument()
  })

  it('lists who is using the host', async () => {
    renderWithQuery(<Overview />)
    expect(await screen.findByText('Using this host')).toBeInTheDocument()
    for (const link of screen.getAllByRole('link', { name: 'Meu Produto' })) expect(link).toHaveAttribute('href', '/projects/produto')
  })

  it('opens with the host rather than a page title', async () => {
    const snapshot = emptySnapshot({ id: 'i', name: 'lab', hostname: 'lab' }, 1_700_000_000)
    snapshot.host.hostname = 'lab'
    snapshot.host.productName = 'MacBook Pro (14-inch, M3 Pro, Nov 2023)'
    snapshot.host.kind = 'notebook'
    snapshot.host.distro = 'macOS'
    snapshot.host.version = '26.5.2'
    snapshot.host.architecture = 'arm64'
    snapshot.host.uptimeSeconds = 3600 * 24 * 17
    metricsCurrent.mockResolvedValue({ ...snapshot, ageSeconds: 4, stale: false, collectorActive: true })
    renderWithQuery(<Overview />)
    expect(await screen.findByText(/MacBook Pro/)).toHaveTextContent('MacBook Pro · Notebook')
    expect(screen.getByText(/^lab · macOS 26\.5\.2 · arm64 · up 17d 0h$/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.queryByText(/What is being worked on/)).not.toBeInTheDocument()
    expect(screen.getByText('Gateway running')).toBeInTheDocument()
  })

  it('falls back to the gateway status when the dashboard needs the database', async () => {
    developmentOverview.mockRejectedValue(new ApiError(503, 'panel persistence is unavailable'))
    renderWithQuery(<Overview />)
    expect(await screen.findByText("The development dashboard needs the panel's database")).toBeInTheDocument()
    expect(screen.getByText('Unhealthy containers')).toBeInTheDocument()
    expect(screen.getByText('Gateway running')).toBeInTheDocument()
  })
})
