import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import { EndpointList } from '@/components/entities/endpoint-list'

const urls = [
  { url: 'https://a.public.example', host: 'a.public.example', scope: 'public' as const, scheme: 'https' as const },
  { url: 'http://a.localhost', host: 'a.localhost', scope: 'local' as const, scheme: 'http' as const },
]

describe('endpoint list', () => {
  it('lists nearest first with a scope badge each', () => {
    renderWithQuery(<EndpointList endpoints={urls} />, 'en')
    const links = [...new Set(screen.getAllByRole('link').map((link) => link.getAttribute('href')))]
    expect(links).toEqual(['http://a.localhost', 'https://a.public.example'])
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('public')).toBeInTheDocument()
  })
  it('drops the badge when compact and alone', () => {
    renderWithQuery(<EndpointList endpoints={[urls[1]!]} compact />, 'en')
    expect(screen.queryByText('local')).toBeNull()
  })
  it('renders nothing for nothing', () => {
    const { container } = renderWithQuery(<EndpointList endpoints={[]} />, 'en')
    expect(container.textContent).toBe('')
  })
})
