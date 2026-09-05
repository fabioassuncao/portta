import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { TaskDescription } from '@/components/tasks/task-description'
import { MarkdownEditor } from '@/components/tasks/markdown-editor'
import { MarkdownView } from '@/components/tasks/markdown-view'
import { EditableTitle } from '@/components/tasks/editable-title'

describe('task Markdown editing', () => {
  it('saves an inline title with Enter, and Escape restores the previous title', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<EditableTitle value="Old title" onSave={save} />)
    await userEvent.click(screen.getByText('Old title'))
    const input = screen.getByRole('textbox', { name: 'Title' })
    await userEvent.clear(input)
    await userEvent.type(input, 'New title{Escape}')
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Old title' })).toBeInTheDocument()
    await userEvent.click(screen.getByText('Old title'))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Title' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Saved title{Enter}')
    await waitFor(() => expect(save).toHaveBeenCalledWith('Saved title'))
  })

  it('flushes the draft on Escape and returns to the same rendered view', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<TaskDescription value="Original" onSave={save} />)
    await userEvent.click(screen.getByText('Original'))
    const editor = screen.getByRole('textbox')
    await userEvent.clear(editor)
    await userEvent.type(editor, '## Changed')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(save).toHaveBeenCalledWith('## Changed'))
    expect(await screen.findByRole('heading', { name: 'Changed' })).toBeInTheDocument()
  })

  it('flushes on an outside pointer without silently discarding text', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<><TaskDescription value="Original" onSave={save} /><button type="button">Outside</button></>)
    await userEvent.click(screen.getByText('Original'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Kept outside' } })
    await userEvent.click(screen.getByRole('button', { name: 'Outside' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('Kept outside'))
    expect(await screen.findByText('Kept outside')).toBeInTheDocument()
  })

  it('uses the safe GFM renderer for preview and reading', async () => {
    const source = '## Heading\n\n- [x] API\n\n| Service | Status |\n|---|---|\n| API | OK |\n\n<script>alert(1)</script>'
    const { container } = renderWithQuery(<><MarkdownEditor value={source} onChange={vi.fn()} /><MarkdownView source={source} /></>)
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getAllByRole('heading', { name: 'Heading' })).toHaveLength(2)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getAllByRole('table')).toHaveLength(2)
    expect(container.querySelector('script')).toBeNull()
  })
})
