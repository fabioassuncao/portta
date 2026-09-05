import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import type { AccessView } from 'portta-contracts'

const access = vi.fn()
const openBridge = vi.fn()
const closeBridge = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    access: () => access(),
    openBridge: (...args: unknown[]) => openBridge(...args),
    closeBridge: (...args: unknown[]) => closeBridge(...args),
    serviceConnection: () => Promise.resolve({
      project: 'alpha',
      service: 'postgres',
      kind: 'postgres',
      endpoints: [],
      credentials: { discovered: false, user: null, password: null, database: null, source: null, reason: 'not requested' },
    }),
  },
}))

const { AccessView: Access } = await import('../../app/(panel)/access/access-view.tsx')

const view: AccessView = {
  bridgeImageHint: 'alpine/socat:1.8.1.3',
  tcpRoutingEnabled: true,
  forwarders: [],
  bridges: [
    {
      id: 'ab12cd',
      containerId: 'bridge-1',
      project: 'alpha',
      service: 'postgres',
      targetPort: 5432,
      localPort: 55431,
      bindIp: '127.0.0.1',
      kind: 'postgres',
      network: 'alpha_default',
      createdAt: 1_700_000_000,
      expiresAt: null,
      state: 'running',
      connectionString: 'postgresql://<user>@127.0.0.1:55431/<database>',
    },
  ],
  services: [
    {
      containerId: 'a-postgres',
      project: 'alpha',
      service: 'postgres',
      image: 'postgres:18.6-alpine',
      kind: 'postgres',
      tech: { id: 'postgres', label: 'PostgreSQL' },
      state: 'running',
      health: 'healthy',
      ports: [5432],
      defaultPort: 5432,
      publishedPorts: [],
      privateNetworks: ['alpha_default'],
      bridge: null,
      forwarder: null,
      integrated: true,
      routing: 'starttls-sni',
      routed: true,
      gatewayAddress: 'storefront-postgres.localhost:5432',
      gatewayConnectionString:
        'postgresql://<user>@storefront-postgres.localhost:5432/<database>?sslmode=require',
    },
    {
      containerId: 'a-redis',
      project: 'alpha',
      service: 'redis',
      image: 'redis:8.10.1-alpine',
      kind: 'redis',
      tech: { id: 'redis', label: 'Redis' },
      state: 'running',
      health: 'none',
      ports: [6379],
      defaultPort: 6379,
      publishedPorts: [],
      privateNetworks: ['alpha_default'],
      bridge: null,
      forwarder: null,
      integrated: true,
      routing: 'tls-sni',
      routed: false,
      gatewayAddress: null,
      gatewayConnectionString: null,
    },
  ],
}

beforeEach(() => {
  access.mockReset().mockResolvedValue(view)
  openBridge.mockReset().mockResolvedValue({ ok: true })
  closeBridge.mockReset().mockResolvedValue({ ok: true })
})

describe('the Access page', () => {
  it('shows the local address and a connection string with no password in it', async () => {
    renderWithQuery(<Access />)
    expect(await screen.findByText('127.0.0.1:55431')).toBeInTheDocument()
    expect(screen.getByText('postgresql://<user>@127.0.0.1:55431/<database>')).toBeInTheDocument()
    expect(screen.getByText(/credentials come from the project/)).toBeInTheDocument()
  })

  it('copies the host, the port and the connection string separately', async () => {
    renderWithQuery(<Access />)
    await screen.findByText('127.0.0.1:55431')

    await userEvent.click(screen.getByRole('button', { name: 'Copy host' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('127.0.0.1')

    await userEvent.click(screen.getByRole('button', { name: 'Copy port' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('55431')

    await userEvent.click(screen.getByRole('button', { name: 'Copy connection string' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'postgresql://<user>@127.0.0.1:55431/<database>',
    )
  })

  it('opens a bridge for a service that has none', async () => {
    renderWithQuery(<Access />)
    const buttons = await screen.findAllByRole('button', { name: /Open local access/ })
    await userEvent.click(buttons[0] as HTMLElement)
    await waitFor(() =>
      expect(openBridge).toHaveBeenCalledWith({ project: 'alpha', service: 'postgres' }),
    )
  })

  it('closes an open bridge', async () => {
    renderWithQuery(<Access />)
    await screen.findByText('127.0.0.1:55431')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(closeBridge).toHaveBeenCalledWith('ab12cd'))
  })

  it('surfaces the reason a bridge could not open', async () => {
    openBridge.mockRejectedValue(
      Object.assign(new Error('the bridge image is not on this host'), {
        hint: 'docker pull alpine/socat:1.8.1.3',
      }),
    )
    renderWithQuery(<Access />)
    const buttons = await screen.findAllByRole('button', { name: /Open local access/ })
    await userEvent.click(buttons[0] as HTMLElement)

    expect(await screen.findByText('the bridge image is not on this host')).toBeInTheDocument()
    expect(screen.getByText('docker pull alpine/socat:1.8.1.3')).toBeInTheDocument()
  })

  it('explains itself when nothing is published on the VPN', async () => {
    renderWithQuery(<Access />)
    expect(await screen.findByText('Nothing is published privately')).toBeInTheDocument()
  })

  it('does not offer a bridge for a service that is not running', async () => {
    access.mockResolvedValue({
      ...view,
      bridges: [],
      services: [{ ...view.services[0]!, state: 'exited' as const }],
    })
    renderWithQuery(<Access />)
    const button = await screen.findByRole('button', { name: /Open local access/ })
    expect(button).toBeDisabled()
  })
})

describe('reaching a database by hostname', () => {
  it('shows the address and says TLS is required', async () => {
    renderWithQuery(<Access />)
    const services = within(await screen.findByRole('table', { name: 'TCP services' }))

    expect(services.getByText('storefront-postgres.localhost:5432')).toBeInTheDocument()
    expect(services.getByText(/TLS required: sslmode=require/)).toBeInTheDocument()
  })

  it('copies the address and the connection string separately', async () => {
    renderWithQuery(<Access />)
    await screen.findByText('storefront-postgres.localhost:5432')

    await userEvent.click(screen.getByRole('button', { name: 'Copy address' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('storefront-postgres.localhost:5432')

    await userEvent.click(screen.getByRole('button', { name: 'Copy gateway connection string' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'postgresql://<user>@storefront-postgres.localhost:5432/<database>?sslmode=require',
    )
  })

  it('says plainly when a project has not opted in', async () => {
    renderWithQuery(<Access />)
    const services = within(await screen.findByRole('table', { name: 'TCP services' }))
    expect(services.getByText('not opted in')).toBeInTheDocument()
  })

  it('does not hide that MySQL cannot share a port by hostname', async () => {
    access.mockResolvedValue({
      ...view,
      services: [
        {
          ...view.services[0]!,
          service: 'mysql',
          kind: 'mysql' as const,
          image: 'mariadb:11.4',
          routing: 'unsupported' as const,
          routed: false,
          gatewayAddress: null,
          gatewayConnectionString: null,
        },
      ],
    })
    renderWithQuery(<Access />)
    expect(await screen.findByText('no hostname sharing')).toBeInTheDocument()
    expect(screen.getByText(/the server speaks first/)).toBeInTheDocument()
  })

  it('says so when hostname routing is switched off entirely', async () => {
    access.mockResolvedValue({ ...view, tcpRoutingEnabled: false, services: [
      { ...view.services[0]!, routed: false, gatewayAddress: null, gatewayConnectionString: null },
    ] })
    renderWithQuery(<Access />)
    expect(await screen.findByText('hostname routing is off')).toBeInTheDocument()
  })
})

describe('the open bridges table', () => {
  it('keeps each bridge on its own row with its target', async () => {
    renderWithQuery(<Access />)
    const table = within(await screen.findByRole('table', { name: 'Open bridges' }))
    expect(table.getByText('target postgres:5432')).toBeInTheDocument()
    expect(table.getByText('no expiry')).toBeInTheDocument()
  })
})
