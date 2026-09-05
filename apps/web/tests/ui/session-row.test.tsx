import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import { makeSession } from './fixtures.ts'
import { SessionRow } from '@/components/entities/session-row'

describe('a session row', () => {
  it('names the agent, the task, the environment and the commits', () => {
    renderWithQuery(<SessionRow session={makeSession({ environment: 'produto-dev' })} showProject />)
    const row = screen.getByRole('group', { name: 'claude session' })
    expect(within(row).getByText('claude-code')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '#42 Implementar refresh token' })).toHaveAttribute('href', '/projects/produto/tasks/42')
    expect(within(row).getByRole('link', { name: 'produto-dev' })).toHaveAttribute('href', '/environments/produto-dev')
    expect(within(row).getByRole('link', { name: 'produto' })).toHaveAttribute('href', '/projects/produto')
    expect(within(row).getByText('1 commits')).toBeInTheDocument()
    expect(within(row).getByText('active')).toBeInTheDocument()
  })

  it('shows an ended session as ended', () => {
    renderWithQuery(<SessionRow session={makeSession({ status: 'ended', endedAt: 1_700_000_900, task: null })} />)
    expect(screen.getByText('ended')).toBeInTheDocument()
    expect(screen.getByText('no task')).toBeInTheDocument()
  })
})
