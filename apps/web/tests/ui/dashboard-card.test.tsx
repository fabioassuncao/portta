import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import type { GatewayStatus } from 'portta-contracts'

const gateway = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: { gateway: () => gateway() },
}))

const { DashboardCard } = await import('@/components/dashboard-card')

function status(overrides: Partial<GatewayStatus['dashboard']> = {}): GatewayStatus {
  return {
    gatewayVersion: '0.7.2',
    panelVersion: '0.1.0',
    profile: 'local',
    domain: 'localhost',
    privateDomain: null,
    publicDomain: null,
    bindAddress: '127.0.0.1',
    httpPort: '80',
    httpsPort: '443',
    scheme: 'http',
    up: true,
    reachable: true,
    tls: { enabled: false, mode: 'local' },
    tailscale: { enabled: false, running: false, hostname: 'portta' },
    publicAccess: { enabled: false, domain: null },
    panel: {
      expose: 'local',
      routed: false,
      auth: 'disabled',
      authenticated: false,
      readOnly: false,
      docs: true,
    },
    dashboard: {
      enabled: true,
      bindAddress: '127.0.0.1',
      port: '8080',
      expose: 'local',
      advertisedHost: null,
      authenticated: false,
      endpoints: [
        {
          provider: 'local',
          url: 'http://127.0.0.1:8080/dashboard/',
          scope: 'local',
          usable: true,
          shareable: false,
          problem: null,
        },
      ],
      ...overrides,
    },
    traefik: { containerId: 't', state: 'running', health: 'healthy' },
    socketProxy: { containerId: 's', state: 'running' },
    database: { containerId: 'd', state: 'running', health: 'healthy' },
    network: { name: 'portta', exists: true, attached: 3, internal: false },
    routes: 0,
  }
}

describe('the Traefik dashboard card', () => {
  it('opens when an endpoint is usable', async () => {
    gateway.mockReset().mockResolvedValue(status())
    renderWithQuery(<DashboardCard />)
    expect(await screen.findByRole('button', { name: 'Open the Traefik dashboard' })).toBeEnabled()
    expect(screen.getByText('http://127.0.0.1:8080/dashboard/')).toBeInTheDocument()
    expect(screen.getByText('this machine only')).toBeInTheDocument()
  })

  it('disables Open when nothing is usable from here', async () => {
    gateway.mockReset().mockResolvedValue(status({
      endpoints: [
        {
          provider: 'custom-domain',
          url: 'https://portta-traefik.dev.example.com/dashboard/',
          scope: 'public',
          usable: false,
          shareable: false,
          problem: 'Traefik listens on 127.0.0.1 only',
        },
      ],
      expose: 'domain',
      advertisedHost: 'portta-traefik.dev.example.com',
    }))
    renderWithQuery(<DashboardCard />)
    expect(await screen.findByRole('button', { name: 'Open the Traefik dashboard' })).toBeDisabled()
    expect(screen.getByText(/Traefik listens on 127.0.0.1 only/)).toBeInTheDocument()
  })
})
