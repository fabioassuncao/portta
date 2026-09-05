import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ToastProvider, useToast } from '@/components/ui/toast'

function Trigger() {
  const toast = useToast()
  return (
    <button onClick={() => toast.push({ tone: 'danger', title: 'The action failed', description: 'refused', duration: 0 })}>
      go
    </button>
  )
}

describe('toasts', () => {
  it('announces in a live region and can be dismissed', async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByText('go'))
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('alert')).toHaveTextContent('The action failed')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does nothing without a provider, instead of throwing', async () => {
    render(<Trigger />)
    await userEvent.click(screen.getByText('go'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
