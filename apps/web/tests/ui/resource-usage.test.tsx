import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import { ResourceUsage } from '@/components/entities/resource-usage'

describe('resource usage', () => {
  it('formats what it knows and leaves out what it does not', () => {
    renderWithQuery(<ResourceUsage cpu={0.123} memoryBytes={210 * 1024 * 1024} />, 'en')
    expect(screen.getByText(/^CPU 12% · RAM 210(\.0)? MB$/)).toBeInTheDocument()
  })
  it('says when nothing was measured', () => {
    renderWithQuery(<ResourceUsage cpu={null} memoryBytes={null} />, 'en')
    expect(screen.getByText('not measured')).toBeInTheDocument()
  })
  it('renders bars with a limit', () => {
    const { container } = renderWithQuery(<ResourceUsage variant="bar" cpu={0.5} memoryBytes={1024} memoryLimitBytes={2048} />, 'en')
    expect(screen.getByText(/^1(\.0)? KB \/ 2(\.0)? KB$/)).toBeInTheDocument()
    expect(container.querySelectorAll('[aria-hidden]').length).toBe(2)
  })
})
