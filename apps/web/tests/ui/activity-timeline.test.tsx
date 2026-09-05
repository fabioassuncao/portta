import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import { makeEvent } from './fixtures.ts'
import { ActivityTimeline } from '@/components/entities/activity-timeline'

describe('the activity timeline', () => {
  it('lists what happened with links to the task, the repository and the environment', () => {
    renderWithQuery(
      <ActivityTimeline
        showProject
        events={[
          makeEvent(),
          makeEvent({ id: 'e2', kind: 'repository.commit', summary: '2 commits on api', actor: null, actorKind: null, taskId: null, taskTitle: null, repositoryId: 'r1', repositoryName: 'api', environment: 'produto-dev' }),
        ]}
      />,
    )
    expect(screen.getByText('#42 moved to in progress')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '#42 Implementar refresh token' })).toHaveAttribute('href', '/projects/produto/tasks/42')
    expect(screen.getByRole('link', { name: 'api' })).toHaveAttribute('href', '/projects/produto/repositories/r1')
    expect(screen.getByRole('link', { name: 'produto-dev' })).toHaveAttribute('href', '/environments/produto-dev')
    expect(screen.getAllByRole('link', { name: 'produto' })[0]).toHaveAttribute('href', '/projects/produto')
    expect(screen.getAllByText('claude')).toHaveLength(1)
  })

  it('says plainly when nothing happened', () => {
    renderWithQuery(<ActivityTimeline events={[]} />)
    expect(screen.getByText('Nothing happened yet')).toBeInTheDocument()
  })
})
