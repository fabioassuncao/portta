import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeContainer } from './fixtures.ts'

const removalPreview = vi.fn()
const removeContainer = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    removalPreview: (...args: unknown[]) => removalPreview(...args),
    removeContainer: (...args: unknown[]) => removeContainer(...args),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    containerAction: vi.fn(),
  },
}))

const { RemoveDialog } = await import('@/components/container-actions')

const external = makeContainer({
  id: 'ext-pg',
  name: 'legacy-postgres',
  image: 'postgres:18.6-alpine',
  ownership: 'external',
  environment: 'legacy',
})

beforeEach(() => {
  removalPreview.mockReset().mockResolvedValue({
    containerId: 'ext-pg',
    name: 'legacy-postgres',
    image: 'postgres:18.6-alpine',
    ownership: 'external',
    state: 'running',
    project: 'legacy',
    mounts: [],
    namedVolumes: ['legacy_pgdata'],
    networks: ['legacy_default'],
    warnings: [
      'the container is running and will be stopped first',
      '1 named volume(s) stay on the host: legacy_pgdata',
      'networks are kept: legacy_default',
    ],
    allowed: true,
  })
  removeContainer.mockReset().mockResolvedValue({ ok: true })
})

describe('removing a container asks first, and says what stays', () => {
  it('identifies the container, its image and whose it is', async () => {
    renderWithQuery(<RemoveDialog container={external} open onOpenChange={() => {}} />)

    expect(await screen.findByText('legacy-postgres')).toBeInTheDocument()
    expect(screen.getByText('postgres:18.6-alpine')).toBeInTheDocument()
    expect(screen.getByText('External')).toBeInTheDocument()
  })

  it('names the volumes and promises to keep them', async () => {
    renderWithQuery(<RemoveDialog container={external} open onOpenChange={() => {}} />)

    expect(await screen.findByText('legacy_pgdata')).toBeInTheDocument()
    expect(screen.getByText(/They are kept/)).toBeInTheDocument()
    expect(screen.getByText(/never removes a volume, and never runs a prune/)).toBeInTheDocument()
    expect(screen.getByText(/networks are kept: legacy_default/)).toBeInTheDocument()
  })

  it('removes nothing until the button is pressed', async () => {
    renderWithQuery(<RemoveDialog container={external} open onOpenChange={() => {}} />)
    await screen.findByText('legacy_pgdata')
    expect(removeContainer).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Remove container' }))
    await waitFor(() => expect(removeContainer).toHaveBeenCalledWith('ext-pg', true))
  })

  it('closes without removing anything on cancel', async () => {
    const onOpenChange = vi.fn()
    renderWithQuery(<RemoveDialog container={external} open onOpenChange={onOpenChange} />)
    await screen.findByText('legacy_pgdata')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(removeContainer).not.toHaveBeenCalled()
  })

  it('refuses outright for a gateway component', async () => {
    removalPreview.mockResolvedValue({
      containerId: 'gw-traefik',
      name: 'portta-traefik-1',
      image: 'traefik:v3.7.12',
      ownership: 'gateway',
      state: 'running',
      project: null,
      mounts: [],
      namedVolumes: [],
      networks: [],
      warnings: ['this is a Portta component; the panel does not remove its own infrastructure'],
      allowed: false,
    })
    const gateway = makeContainer({ id: 'gw-traefik', name: 'portta-traefik-1', ownership: 'gateway' })
    renderWithQuery(<RemoveDialog container={gateway} open onOpenChange={() => {}} />)

    expect(
      await screen.findByText('The panel does not remove its own infrastructure'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove container' })).toBeDisabled()
  })

  it('shows the error and keeps the dialog open when Docker refuses', async () => {
    removeContainer.mockRejectedValue(Object.assign(new Error('permission denied'), { hint: 'check the socket proxy' }))
    renderWithQuery(<RemoveDialog container={external} open onOpenChange={() => {}} />)
    await screen.findByText('legacy_pgdata')

    await userEvent.click(screen.getByRole('button', { name: 'Remove container' }))
    expect(await screen.findByText('permission denied')).toBeInTheDocument()
    expect(screen.getByText('check the socket proxy')).toBeInTheDocument()
  })
})
