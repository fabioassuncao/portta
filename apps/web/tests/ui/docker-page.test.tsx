import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { CONTAINERS, HOST } from './fixtures.ts'

const containers = vi.fn()
const host = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    containers: (...args: unknown[]) => containers(...args),
    host: () => host(),
    removalPreview: vi.fn().mockResolvedValue({ allowed: true, warnings: [], namedVolumes: [] }),
    containerAction: vi.fn().mockResolvedValue({ ok: true }),
    removeContainer: vi.fn().mockResolvedValue({ ok: true }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    stats: vi.fn().mockResolvedValue({ cpuPercent: null }),
    // The Docker page joins the collector's per-container readings by id.
    metricsCurrent: vi.fn().mockResolvedValue({
      version: 1, instance: { id: '', name: null, hostname: null }, collectedAt: null, ageSeconds: null,
      stale: true, collectorActive: false, host: null, runtime: null, projects: [],
    }),
  },
}))

const { DockerView: DockerPage } = await import('../../app/(panel)/docker/docker-view.tsx')

beforeEach(() => {
  containers.mockReset().mockResolvedValue({ containers: CONTAINERS, total: CONTAINERS.length })
  host.mockReset().mockResolvedValue(HOST)
})

describe('the Docker page', () => {
  const group = (name: string) => within(screen.getByRole('table', { name: new RegExp(name) }))
  const tile = (name: string) =>
    screen.getByRole('group', { name }).querySelector('[data-slot="value"]')?.textContent

  it('keeps external containers in their own section, away from the projects', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('table', { name: /External Docker/ })

    expect(screen.getByRole('heading', { name: /Integrated projects/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Standalone containers/ })).toBeInTheDocument()

    expect(group('External Docker').getByText('legacy-postgres')).toBeInTheDocument()
    expect(group('External Docker').queryByText('alpha-web-1')).not.toBeInTheDocument()
    expect(group('Integrated projects').getByText('alpha-web-1')).toBeInTheDocument()
    expect(group('Portta').getByText('portta-traefik-1')).toBeInTheDocument()
  })

  it('counts what belongs to the gateway and what does not', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('group', { name: 'Running' })

    expect(tile('Running')).toBe('3')
    expect(tile('Portta')).toBe('1')
    expect(tile('Integrated')).toBe('1')
    expect(tile('External')).toBe('2')
    expect(tile('Port conflicts')).toBe('1')
  })

  it('filters by ownership', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('table', { name: /External Docker/ })

    await userEvent.selectOptions(screen.getByLabelText('Filter by ownership'), 'external')
    await waitFor(() => expect(screen.queryByRole('table', { name: /Integrated projects/ })).toBeNull())
    expect(group('External Docker').getByText('legacy-postgres')).toBeInTheDocument()
  })

  it('filters by state', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('table', { name: /Standalone containers/ })

    await userEvent.selectOptions(screen.getByLabelText('Filter by state'), 'stopped')
    await waitFor(() => expect(screen.queryByRole('table', { name: 'External Docker' })).toBeNull())
    expect(group('Standalone containers').getByText('some-old-container')).toBeInTheDocument()
  })

  it('searches across name, image and project', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('table', { name: /External Docker/ })

    await userEvent.type(screen.getByLabelText('Search containers'), 'postgres')
    await waitFor(() => expect(screen.queryByRole('table', { name: /Integrated projects/ })).toBeNull())
    expect(group('External Docker').getByText('legacy-postgres')).toBeInTheDocument()
  })

  it('says so when nothing matches, instead of showing an empty table', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('table', { name: /External Docker/ })
    await userEvent.type(screen.getByLabelText('Search containers'), 'nothing-like-this')
    expect(await screen.findByText('No container matches the filters')).toBeInTheDocument()
  })

  it('shows the port conflict the host page exists for', async () => {
    renderWithQuery(<DockerPage />)
    const ports = within(await screen.findByRole('table', { name: 'Published ports' }))
    expect(ports.getByText(/3000\/tcp/)).toBeInTheDocument()
    expect(ports.getByText('conflict')).toBeInTheDocument()
  })
})
