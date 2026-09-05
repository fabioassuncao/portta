import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { docsHref, slugFor, splitDocRefs } from 'portta-contracts'
import { renderWithQuery } from './render.tsx'

const overview = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: { overview: () => overview() },
}))

const { DocText } = await import('@/components/doc-text')

function status(docs: boolean) {
  return { gateway: { panel: { docs } } }
}

beforeEach(() => {
  overview.mockReset().mockResolvedValue(status(true))
})

describe('docsHref', () => {
  it('keeps a section anchor on a settings citation', () => {
    expect(docsHref('docs/addresses-and-access.md#the-panel')).toBe('/docs/addresses-and-access#the-panel')
  })

  it('maps a repository path to the documentation route', () => {
    expect(docsHref('docs/adr/0031-projects-home-and-project.md')).toBe(
      '/docs/adr/0031-projects-home-and-project',
    )
    expect(docsHref('docs/github.md')).toBe('/docs/github')
    expect(slugFor('docs/adr/README.md')).toBe('adr')
  })

  it('maps the documentation HTTP paths the settings copy already uses', () => {
    expect(docsHref('/docs')).toBe('/docs/')
    expect(docsHref('/docs/')).toBe('/docs/')
    expect(docsHref('/docs/api')).toBe('/docs/api')
  })
})

describe('splitDocRefs', () => {
  it('keeps the anchor on a markdown citation', () => {
    expect(splitDocRefs('See docs/addresses-and-access.md#the-panel.')).toEqual([
      { text: 'See ', href: null },
      { text: 'docs/addresses-and-access.md#the-panel', href: '/docs/addresses-and-access#the-panel' },
      { text: '.', href: null },
    ])
  })

  it('leaves surrounding copy intact', () => {
    expect(splitDocRefs('See docs/github.md for the App.')).toEqual([
      { text: 'See ', href: null },
      { text: 'docs/github.md', href: '/docs/github' },
      { text: ' for the App.', href: null },
    ])
  })

  it('does not let /docs eat /docs/api', () => {
    const parts = splitDocRefs('the console at /docs/api.')
    expect(parts.some((part) => part.href === '/docs/api')).toBe(true)
    expect(parts.some((part) => part.text === '/docs/api')).toBe(true)
  })
})

describe('DocText', () => {
  it('turns a documentation path into a deep link', async () => {
    renderWithQuery(<DocText>See docs/adr/0031-projects-home-and-project.md.</DocText>)
    const link = await screen.findByRole('link', { name: 'docs/adr/0031-projects-home-and-project.md' })
    expect(link).toHaveAttribute('href', '/docs/adr/0031-projects-home-and-project')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('links /docs/api to the API reference page', async () => {
    renderWithQuery(<DocText>Serve the console at /docs/api.</DocText>)
    const link = await screen.findByRole('link', { name: '/docs/api' })
    expect(link).toHaveAttribute('href', '/docs/api')
  })

  it('replaces a markdown citation with the settings label', async () => {
    renderWithQuery(
      <DocText citationLabel="Learn more">See docs/adr/0031-projects-home-and-project.md.</DocText>,
    )
    const link = await screen.findByRole('link', { name: 'Learn more' })
    expect(link).toHaveAttribute('href', '/docs/adr/0031-projects-home-and-project')
    expect(screen.queryByText(/See/)).not.toBeInTheDocument()
    expect(screen.queryByText(/docs\/adr/)).not.toBeInTheDocument()
  })

  it('keeps /docs/api as the address when a citation label is set', async () => {
    renderWithQuery(
      <DocText citationLabel="Learn more">Serve the console at /docs/api.</DocText>,
    )
    const link = await screen.findByRole('link', { name: '/docs/api' })
    expect(link).toHaveAttribute('href', '/docs/api')
    expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument()
  })

  it('stays plain text when the panel does not serve the documentation', async () => {
    overview.mockResolvedValue(status(false))
    renderWithQuery(<DocText>See docs/github.md.</DocText>)
    await waitFor(() => {
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
    expect(screen.getByText('See docs/github.md.')).toBeInTheDocument()
  })
})
