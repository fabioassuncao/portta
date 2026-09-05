import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeRepositoryGit } from './fixtures.ts'
import { InstructionsPanel } from '@/components/entities/instructions-panel'

describe('the instructions panel', () => {
  const files = makeRepositoryGit().instructions

  it('lists the files with audience, size and whether they are uncommitted', () => {
    renderWithQuery(<InstructionsPanel files={files} compact />, 'en')
    expect(screen.getByText('AGENTS.md')).toBeInTheDocument()
    expect(screen.getByText('any agent')).toBeInTheDocument()
    expect(screen.getByText('Cursor')).toBeInTheDocument()
    expect(screen.getByText('uncommitted')).toBeInTheDocument()
    expect(screen.getByText('over 64 KiB')).toBeInTheDocument()
    expect(screen.queryByLabelText('AGENTS.md')).not.toBeInTheDocument()
  })

  it('shows the selected file as text and explains a file over the bound', async () => {
    renderWithQuery(<InstructionsPanel files={files} />, 'en')
    expect(screen.getByLabelText('AGENTS.md')).toHaveTextContent('# Rules Never prune.')
    await userEvent.click(screen.getByRole('button', { name: /style\.mdc/ }))
    expect(await screen.findByText(/over the collection bound/)).toBeInTheDocument()
  })

  it('says when there is nothing', () => {
    renderWithQuery(<InstructionsPanel files={[]} />, 'en')
    expect(screen.getByText('No instruction file')).toBeInTheDocument()
  })
})
