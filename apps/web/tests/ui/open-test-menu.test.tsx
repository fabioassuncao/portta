import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeService } from './fixtures.ts'

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    openBridge: vi.fn().mockResolvedValue({ ok: true }),
    closeBridge: vi.fn().mockResolvedValue({ ok: true }),
    serviceConnection: vi.fn().mockResolvedValue({ project: 'alpha', service: 'postgres', kind: 'postgres', endpoints: [{ provider: 'internal', url: 'postgres:5432', scope: 'internal', usable: true, shareable: false, problem: null, connectionString: 'postgres://user@postgres:5432/app' }], credentials: { discovered: true, user: 'user', password: 'hunter2', database: 'app', source: 'env', reason: null } }),
  },
}))

const { OpenTestMenu } = await import('@/components/entities/open-test-menu')

describe('the Open / Test menu', () => {
  it('lists every address by scope, nearest first, and opens one', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderWithQuery(<OpenTestMenu service={makeService()} onLogs={() => {}} />, 'en')
    await userEvent.click(screen.getByRole('button', { name: 'Open / Test' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent?.trim())).toEqual(['http://alpha-web.localhost', 'https://alpha-web.dev.example.test', 'Logs'])
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('public')).toBeInTheDocument()
    await userEvent.click(items[1]!)
    expect(open).toHaveBeenCalledWith('https://alpha-web.dev.example.test', '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it('offers a datastore the bridge, the copies and the connection details', async () => {
    const service = makeService({
      name: 'postgres', kind: 'postgres', containerId: 'a-pg',
      access: { kind: 'tcp', primary: { provider: 'local', url: 'alpha-postgres.localhost:5432', scope: 'local', usable: true, shareable: false, problem: null }, endpoints: [{ provider: 'local', url: 'alpha-postgres.localhost:5432', scope: 'local', usable: true, shareable: false, problem: null }], bridge: { id: 'b1', containerId: 'x', project: 'alpha', service: 'postgres', targetPort: 5432, localPort: 55431, bindIp: '127.0.0.1', kind: 'postgres', network: 'alpha_default', createdAt: null, expiresAt: null, state: 'running', connectionString: 'postgres://user@127.0.0.1:55431/app' }, routed: false, problem: null },
      actions: { start: false, stop: true, restart: true, logs: true, openAccess: false, share: false },
    })
    renderWithQuery(<OpenTestMenu service={service} />, 'en')
    await userEvent.click(screen.getByRole('button', { name: 'Open / Test' }))
    expect(await screen.findByRole('menuitem', { name: /alpha-postgres.localhost:5432/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Copy connection string/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Close local access/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Connection details…' }))
    expect(await screen.findByRole('dialog', { name: 'Connection details · postgres' })).toBeInTheDocument()
    expect(await screen.findByText('postgres:5432')).toBeInTheDocument()
  })

  it('says when there is nothing to open', async () => {
    renderWithQuery(<OpenTestMenu service={makeService({ access: { kind: 'http', primary: null, endpoints: [], bridge: null, routed: false, problem: null } })} />, 'en')
    await userEvent.click(screen.getByRole('button', { name: 'Open / Test' }))
    expect(await screen.findByRole('menuitem', { name: 'Nothing to open yet' })).toBeInTheDocument()
  })
})
