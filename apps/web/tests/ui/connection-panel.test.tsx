import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import type { ServiceConnection } from 'portta-contracts'

const serviceConnection = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    serviceConnection: (...args: unknown[]) => serviceConnection(...args),
  },
}))

const { ConnectionPanel } = await import('@/components/connection-panel')

const data: ServiceConnection = {
  project: 'alpha',
  service: 'postgres',
  kind: 'postgres',
  endpoints: [
    {
      provider: 'local',
      url: 'alpha-postgres.localhost:5432',
      scope: 'local',
      usable: true,
      shareable: false,
      problem: null,
      connectionString: 'postgresql://shop:s3cret@alpha-postgres.localhost:5432/storefront?sslmode=require',
    },
    {
      provider: 'custom-domain',
      url: 'alpha-postgres.dev.example.com:5432',
      scope: 'public',
      usable: true,
      shareable: true,
      problem: null,
      connectionString: 'postgresql://shop:s3cret@alpha-postgres.dev.example.com:5432/storefront?sslmode=require',
    },
  ],
  credentials: {
    discovered: true,
    user: 'shop',
    password: 's3cret',
    database: 'storefront',
    source: 'POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB',
    reason: null,
  },
}

describe('ConnectionPanel', () => {
  it('fetches on demand, masks the password, and copies it without revealing', async () => {
    serviceConnection.mockReset().mockResolvedValue(data)
    renderWithQuery(<ConnectionPanel project="alpha" service="postgres" />)

    expect(serviceConnection).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(serviceConnection).toHaveBeenCalledWith('alpha', 'postgres'))

    expect(screen.getByText('alpha-postgres.localhost:5432')).toBeInTheDocument()
    expect(screen.getByText('alpha-postgres.dev.example.com:5432')).toBeInTheDocument()
    expect(screen.getByText('••••••••')).toBeInTheDocument()
    expect(screen.queryByText('s3cret')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Copy password' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('s3cret')
    expect(screen.queryByText('s3cret')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Reveal password' }))
    expect(screen.getByText('s3cret')).toBeInTheDocument()
  })

  it('shows the reason when a credential cannot be discovered', async () => {
    serviceConnection.mockReset().mockResolvedValue({
      ...data,
      credentials: {
        discovered: false,
        user: null,
        password: null,
        database: null,
        source: null,
        reason: 'POSTGRES_PASSWORD is not in the container environment',
      },
      endpoints: [{ ...data.endpoints[0]!, connectionString: 'postgresql://<user>@alpha-postgres.localhost:5432/<database>?sslmode=require' }],
    })
    renderWithQuery(<ConnectionPanel project="alpha" service="postgres" />)
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText(/POSTGRES_PASSWORD is not in the container environment/)).toBeInTheDocument()
  })
})
