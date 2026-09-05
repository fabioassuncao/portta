import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import { makeContainer, makeService } from './fixtures.ts'

const logs = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    logs: (...args: unknown[]) => logs(...args),
    shares: vi.fn().mockResolvedValue({ shares: [], publicAllowed: false }),
    serviceTraefik: vi.fn().mockResolvedValue({ available: false, reason: 'not configured' }),
    containerAction: vi.fn().mockResolvedValue({ ok: true }),
    removalPreview: vi.fn().mockResolvedValue({ allowed: true, warnings: [], namedVolumes: [] }),
    serviceConnection: vi.fn().mockResolvedValue({ endpoints: [], credentials: { discovered: false, user: null, password: null, database: null, source: null, reason: null } }),
  },
}))

const { ServiceDrawer } = await import('@/components/entities/service-drawer')

const web = makeContainer({
  id: 'a-web', name: 'alpha-web-1', environment: 'alpha', service: 'web', ownership: 'integrated', traefikEnabled: true, onGatewayNetwork: true, kind: 'http',
  networks: ['portta', 'alpha_default'], exposedPorts: [3000], urls: [{ url: 'http://alpha-web.localhost', host: 'alpha-web.localhost', scope: 'local', scheme: 'http' }],
  mounts: [{ type: 'bind', name: null, source: '/srv/dev/alpha', destination: '/app', rw: true }],
  labels: { 'traefik.enable': 'true' },
})

beforeEach(() => {
  logs.mockReset().mockResolvedValue({ lines: [{ stream: 'stdout', timestamp: null, text: 'listening on 3000' }], truncated: false })
})

describe('the service drawer', () => {
  it('shows the container, its access, its mounts and the share controls', async () => {
    renderWithQuery(<ServiceDrawer container={web} service={makeService()} open onOpenChange={() => {}} />, 'en')
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('web')
    expect(screen.getByRole('link', { name: 'http://alpha-web.localhost' })).toBeInTheDocument()
    expect(screen.getByText(/bind: \/srv\/dev\/alpha → \/app/)).toBeInTheDocument()
    expect(screen.getByText('portta, alpha_default')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Share with a password/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open environment' })).toHaveAttribute('href', '/environments/alpha')
  })

  it('reads the logs inline', async () => {
    renderWithQuery(<ServiceDrawer container={web} open onOpenChange={() => {}} section="logs" />, 'en')
    expect(await screen.findByText('listening on 3000')).toBeInTheDocument()
    expect(logs).toHaveBeenCalledWith('a-web', 200)
  })

  it('shows the measurement as bars when a row was served', async () => {
    renderWithQuery(<ServiceDrawer container={web} service={makeService()} open onOpenChange={() => {}} />, 'en')
    await screen.findByRole('dialog')
    expect(screen.getByText('8%')).toBeInTheDocument()
  })
})
