import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeTaskSummary } from './fixtures.ts'
import { TaskBoard, planBoardMove } from '@/components/tasks/task-board'

describe('the task board', () => {
  it('puts each task in the column of its status and moves it from the menu', async () => {
    const onMove = vi.fn()
    const tasks = [
      makeTaskSummary({ id: '1', status: 'ready', title: 'Ready one' }),
      makeTaskSummary({ id: '2', status: 'in_progress', title: 'Busy one', agent: 'claude-code', assignee: null }),
      makeTaskSummary({ id: '3', status: 'done', title: 'Done one', github: { repository: 'acme/api', number: 9, htmlUrl: 'https://github.com/acme/api/issues/9', syncState: 'conflict' } }),
    ]
    renderWithQuery(<TaskBoard slug="produto" tasks={tasks} onMove={onMove} />)

    expect(within(screen.getByRole('region', { name: 'To do column' })).getByRole('article', { name: '#1 Ready one' })).toBeInTheDocument()
    const busy = within(screen.getByRole('region', { name: 'In progress column' })).getByRole('article', { name: '#2 Busy one' })
    expect(within(busy).getByText('claude-code')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Done column' })).getByLabelText('conflict')).toBeInTheDocument()

    await userEvent.click(within(busy).getByRole('button', { name: 'Actions for #2' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Review' }))
    expect(onMove).toHaveBeenCalledWith(tasks[1], 'review', null, null)
    expect(screen.getByText('#2 moved to Review')).toBeInTheDocument()
  })

  it('plans a drop between columns and a reorder inside one column', () => {
    const backlog = makeTaskSummary({ id: '32', status: 'backlog', title: 'A', position: 1024 })
    const todoA = makeTaskSummary({ id: '41', status: 'ready', title: 'B', position: 1024 })
    const todoB = makeTaskSummary({ id: '18', status: 'ready', title: 'C', position: 2048 })
    const todoC = makeTaskSummary({ id: '27', status: 'ready', title: 'D', position: 3072 })
    expect(planBoardMove([backlog, todoA, todoB, todoC], backlog, 'ready', todoA.id, 'before')).toEqual({ beforeId: null, afterId: '41' })
    expect(planBoardMove([backlog, todoA, todoB, todoC], todoC, 'ready', todoA.id, 'before')).toEqual({ beforeId: null, afterId: '41' })
    expect(planBoardMove([backlog, todoA, todoB, todoC], todoC, 'ready')).toBeNull()
  })

  it('does not offer a destination move from the menu when the board is read-only', async () => {
    const onMove = vi.fn()
    renderWithQuery(<TaskBoard slug="produto" tasks={[makeTaskSummary({ id: '2', status: 'in_progress', title: 'Busy one' })]} onMove={onMove} readOnly />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions for #2' }))
    expect(await screen.findByRole('menuitem', { name: 'Move to Review' })).toHaveAttribute('aria-disabled', 'true')
    expect(onMove).not.toHaveBeenCalled()
  })

  it('links every card to its task page', () => {
    renderWithQuery(<TaskBoard slug="produto" tasks={[makeTaskSummary({ id: '5', title: 'Linked' })]} onMove={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Linked' })).toHaveAttribute('href', '/projects/produto/tasks/5')
  })

  it('names the project on a global board without growing the card', () => {
    renderWithQuery(
      <TaskBoard
        tasks={[makeTaskSummary({ id: '5', project: 'portta', title: 'Linked' })]}
        onMove={vi.fn()}
        showProject
        projectNames={{ portta: 'Portta' }}
        from="tasks"
      />,
    )
    expect(screen.getByRole('link', { name: 'Portta' })).toHaveAttribute('href', '/projects/portta')
    expect(screen.getByRole('link', { name: 'Linked' })).toHaveAttribute('href', '/projects/portta/tasks/5?from=tasks')
  })
})
