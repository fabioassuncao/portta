import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeService } from './fixtures.ts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.status = status
    this.hint = hint
  }
}

const serviceAction = vi.fn()
const containerAction = vi.fn()
const openBridge = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError,
  api: {
    serviceAction: (...args: unknown[]) => serviceAction(...args),
    containerAction: (...args: unknown[]) => containerAction(...args),
    openBridge: (body: unknown) => openBridge(body),
  },
}))

const { ServiceRow, ServiceTableHead } = await import('@/components/entities/service-row')

function renderRow(service = makeService(), onOpen = vi.fn()) {
  const result = renderWithQuery(
    <table>
      <ServiceTableHead />
      <tbody>
        <ServiceRow service={service} onOpen={onOpen} />
      </tbody>
    </table>,
    'en',
  )
  return { ...result, onOpen }
}

beforeEach(() => {
  serviceAction.mockReset().mockResolvedValue({ ok: true })
  containerAction.mockReset().mockResolvedValue({ ok: true })
  openBridge.mockReset().mockResolvedValue({ ok: true })
})

describe('a service row', () => {
  it('folds state, access, resources, runtime and uptime into one row', () => {
    renderRow()
    const row = screen.getByRole('row', { name: 'web service' })
    expect(within(row).getByText('running · healthy')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'http://alpha-web.localhost' })).toBeInTheDocument()
    expect(row).toHaveTextContent('CPU 8%')
    expect(row).toHaveTextContent('300 MB / 1.0 GB')
    expect(row).toHaveTextContent('nginx:1.31.4-alpine')
    expect(row).toHaveTextContent('2h 0m')
  })

  it('opens the drawer from the name and the logs from the button', async () => {
    const { onOpen } = renderRow()
    await userEvent.click(screen.getByRole('button', { name: 'Open web' }))
    expect(onOpen).toHaveBeenCalledWith('overview')
    await userEvent.click(screen.getByRole('button', { name: 'Logs' }))
    expect(onOpen).toHaveBeenCalledWith('logs')
  })

  it('offers only the actions that apply', async () => {
    renderRow()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for web' }))
    expect(await screen.findByRole('menuitem', { name: 'Start' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Stop' })).not.toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Share…' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Open local access' })).not.toBeInTheDocument()
  })

  it('falls back to the container action when the panel has no service route yet', async () => {
    serviceAction.mockRejectedValue(new ApiError(404, 'not found'))
    renderRow()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for web' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }))
    await waitFor(() => expect(containerAction).toHaveBeenCalledWith('a-web', 'stop'))
  })

  it('says why an http service has no address', () => {
    renderRow(makeService({ access: { kind: 'http', primary: null, endpoints: [], bridge: null, routed: true, problem: 'routing is enabled but no hostname was discovered' }, resources: null }))
    const row = screen.getByRole('row', { name: 'web service' })
    expect(within(row).getByText('routing enabled, no hostname discovered')).toBeInTheDocument()
    expect(row).toHaveTextContent('—')
  })

  it('shows a datastore address as text to copy, with a bridge to open', async () => {
    renderRow(makeService({
      name: 'postgres', containerId: 'a-pg', kind: 'postgres', image: 'postgres:18',
      access: { kind: 'tcp', primary: { provider: 'local', url: 'alpha-postgres.localhost:5432', scope: 'local', usable: true, shareable: false, problem: null }, endpoints: [{ provider: 'local', url: 'alpha-postgres.localhost:5432', scope: 'local', usable: true, shareable: false, problem: null }], bridge: null, routed: false, problem: null },
      actions: { start: false, stop: true, restart: true, logs: true, openAccess: true, share: false },
    }))
    const row = screen.getByRole('row', { name: 'postgres service' })
    expect(within(row).getByText('alpha-postgres.localhost:5432')).toBeInTheDocument()
    expect(within(row).queryByRole('link', { name: 'alpha-postgres.localhost:5432' })).not.toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Open / Test' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open local access' }))
    await waitFor(() => expect(openBridge).toHaveBeenCalledWith({ project: 'alpha', service: 'postgres' }))
  })
})
