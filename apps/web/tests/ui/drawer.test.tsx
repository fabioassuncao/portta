import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Drawer } from '@/components/ui/drawer'

describe('the drawer', () => {
  it('opens on the right, names itself, and closes', async () => {
    const onOpenChange = vi.fn()
    render(
      <Drawer open onOpenChange={onOpenChange} title="web" description="node:22">
        <p>body</p>
      </Drawer>,
    )
    const dialog = screen.getByRole('dialog', { name: 'web' })
    expect(dialog).toHaveAttribute('data-side', 'right')
    expect(screen.getByText('body')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
