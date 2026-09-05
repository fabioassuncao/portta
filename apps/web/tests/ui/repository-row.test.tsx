import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import { makeRepository } from './fixtures.ts'
import { RepositoryRow } from '@/components/entities/repository-row'

describe('a repository row', () => {
  it('names the repository, its role, its GitHub and what is checked out', () => {
    renderWithQuery(<RepositoryRow repository={makeRepository()} projectSlug="shop" />, 'en')
    expect(screen.getByRole('link', { name: 'api' })).toHaveAttribute('href', '/projects/shop/repositories/r1')
    expect(screen.getByRole('link', { name: /acme\/api/ })).toHaveAttribute('href', 'https://github.com/acme/api')
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('9f2c1ab')).toBeInTheDocument()
    expect(screen.getByText('7 uncommitted')).toBeInTheDocument()
    expect(screen.getByText('3 ahead')).toBeInTheDocument()
  })

  it('adds the path, the environments and the instruction count as a card', () => {
    renderWithQuery(<RepositoryRow repository={makeRepository()} projectSlug="shop" density="card" />, 'en')
    expect(screen.getByText('/srv/projects/shop/api')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'alpha' })).toHaveAttribute('href', '/environments/alpha')
    expect(screen.getByRole('link', { name: '2 instruction file(s)' })).toHaveAttribute('href', '/projects/shop/repositories/r1/instructions')
  })

  it('says a local repository is local, and one not scanned is not scanned', () => {
    renderWithQuery(<RepositoryRow repository={makeRepository({ provider: 'local', github: null, git: null })} projectSlug="shop" />, 'en')
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('not scanned yet')).toBeInTheDocument()
  })
})
