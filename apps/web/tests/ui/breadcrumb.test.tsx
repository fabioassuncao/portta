import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import { Breadcrumb } from '@/components/ui/breadcrumb'

const trail = [
  { label: 'Projects', href: '/projects' },
  { label: 'Shop', href: '/projects/shop' },
  { label: 'Tasks', href: '/projects/shop/tasks' },
  { label: '#42' },
]

describe('breadcrumb', () => {
  it('is a navigation named Breadcrumb holding an ordered list', () => {
    renderWithQuery(<Breadcrumb items={trail} />, 'en')
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('list').tagName).toBe('OL')
    expect(within(nav).getAllByRole('listitem')).toHaveLength(4)
  })

  it('links every ancestor to its href', () => {
    renderWithQuery(<Breadcrumb items={trail} />, 'en')
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    expect(within(nav).getByRole('link', { name: 'Shop' })).toHaveAttribute('href', '/projects/shop')
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/projects/shop/tasks')
  })

  it('marks the last item as the current page, and it is not a link', () => {
    renderWithQuery(<Breadcrumb items={trail} />, 'en')
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const current = within(nav).getByText('#42')
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current.tagName).toBe('SPAN')
    expect(within(nav).queryByRole('link', { name: '#42' })).toBeNull()
  })

  it('hides everything but the parent and the current item on a narrow screen', () => {
    renderWithQuery(<Breadcrumb items={trail} />, 'en')
    const items = within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getAllByRole('listitem')
    expect(items[0]).toHaveClass('hidden', 'sm:flex')
    expect(items[1]).toHaveClass('hidden', 'sm:flex')
    expect(items[2]).not.toHaveClass('hidden')
    expect(items[3]).not.toHaveClass('hidden')
  })

  it('renders nothing with fewer than two items', () => {
    const { container } = renderWithQuery(<Breadcrumb items={[{ label: 'Alone' }]} />, 'en')
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('dims an ancestor whose name is still loading', () => {
    renderWithQuery(<Breadcrumb items={[{ label: 'Projects', href: '/projects' }, { label: 'shop', href: '/projects/shop', pending: true }, { label: 'api' }]} />, 'en')
    expect(screen.getByRole('link', { name: 'shop' })).toHaveClass('opacity-60')
    expect(screen.getByRole('link', { name: 'Projects' })).not.toHaveClass('opacity-60')
  })

  it('names the navigation in Portuguese too', () => {
    renderWithQuery(<Breadcrumb items={trail} />, 'pt-BR')
    expect(screen.getByRole('navigation', { name: 'Trilha de navegação' })).toBeInTheDocument()
  })
})
