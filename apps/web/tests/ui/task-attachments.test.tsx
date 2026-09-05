import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { TaskAttachments } from '@/components/tasks/task-attachments'
import type { TaskAttachment } from 'portta-contracts'

function attachment(overrides: Partial<TaskAttachment> = {}): TaskAttachment {
  return {
    id: 'a1',
    filename: 'trace.log',
    contentType: 'text/plain',
    sizeBytes: 2048,
    kind: 'text',
    actor: 'fabio',
    actorKind: 'human',
    createdAt: 1_700_000_000,
    downloadUrl: '/api/tasks/42/attachments/a1',
    ...overrides,
  }
}

describe('task attachments', () => {
  it('says what the section is for when it is empty', () => {
    renderWithQuery(<TaskAttachments attachments={[]} onUpload={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByText(/No file attached/)).toBeInTheDocument()
    expect(screen.getByText(/Up to 10 MB each/)).toBeInTheDocument()
  })

  it('links each file to its own bytes, with its size and who added it', () => {
    renderWithQuery(<TaskAttachments attachments={[attachment()]} onUpload={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'trace.log' })).toHaveAttribute('href', '/api/tasks/42/attachments/a1')
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument()
    expect(screen.getByText(/fabio/)).toBeInTheDocument()
  })

  it('shows an image as an image rather than as a filename', () => {
    renderWithQuery(
      <TaskAttachments
        attachments={[attachment({ filename: 'shot.png', kind: 'image', contentType: 'image/png' })]}
        onUpload={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.getByRole('img', { name: 'Preview of shot.png' })).toHaveAttribute('src', '/api/tasks/42/attachments/a1')
  })

  it('takes a file from the picker', async () => {
    const onUpload = vi.fn()
    renderWithQuery(<TaskAttachments attachments={[]} onUpload={onUpload} onRemove={vi.fn()} />)
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    await userEvent.upload(screen.getByLabelText('Attach a file'), file)
    expect(onUpload).toHaveBeenCalledWith([file])
  })

  it('takes a file dropped onto the section', () => {
    const onUpload = vi.fn()
    const { container } = renderWithQuery(<TaskAttachments attachments={[]} onUpload={onUpload} onRemove={vi.fn()} />)
    const section = container.querySelector('section')!
    const file = new File(['x'], 'dropped.png', { type: 'image/png' })
    fireEvent.drop(section, { dataTransfer: { files: [file] } })
    expect(onUpload).toHaveBeenCalledWith([file])
  })

  it('takes a screenshot straight off the clipboard', () => {
    const onUpload = vi.fn()
    const { container } = renderWithQuery(<TaskAttachments attachments={[]} onUpload={onUpload} onRemove={vi.fn()} />)
    const section = container.querySelector('section')!
    const file = new File(['x'], 'image.png', { type: 'image/png' })
    fireEvent.paste(section, { clipboardData: { files: [file] } })
    expect(onUpload).toHaveBeenCalledWith([file])
  })

  it('asks before deleting, and names the file', async () => {
    const onRemove = vi.fn()
    renderWithQuery(<TaskAttachments attachments={[attachment()]} onUpload={vi.fn()} onRemove={onRemove} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove trace.log?' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('The file is deleted from this task and cannot be recovered.')).toBeInTheDocument()
    expect(onRemove).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }))
  })

  it('offers nothing to change when the panel is read-only', () => {
    renderWithQuery(<TaskAttachments attachments={[attachment()]} readOnly onUpload={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Attach a file' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove trace.log?' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'trace.log' })).toBeInTheDocument()
  })
})
