import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DocsToc } from '@/components/docs/docs-shell'

const headings = [
  { id: 'install', text: 'Install', level: 2 },
  { id: 'up', text: 'portta up', level: 3 },
]

describe('DocsToc', () => {
  it('lists the headings on this page', () => {
    render(<DocsToc headings={headings} />)
    expect(screen.getByText('On this page')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Install', hidden: true })).toHaveAttribute('href', '#install')
    expect(screen.getByRole('link', { name: 'portta up', hidden: true })).toHaveAttribute('href', '#up')
  })

  it('stays away when a page is too short to need one', () => {
    const { container } = render(<DocsToc headings={[headings[0]!]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
