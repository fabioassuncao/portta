import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useOptimisticMutation } from '@/lib/optimistic'

const KEY = ['rows']

function harness() {
  const client = new QueryClient({
    // No gcTime override: the cache entry has no observer here, and a zero
    // garbage-collection time would drop it before the assertion runs.
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(KEY, [{ id: '1', status: 'todo' }])
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('the optimistic mutation helper', () => {
  it('applies the change before the server answers', async () => {
    const { client, wrapper } = harness()
    let resolve: (() => void) | null = null

    const { result } = renderHook(
      () =>
        useOptimisticMutation<void, { status: string }, { id: string; status: string }[]>({
          queryKey: KEY,
          mutationFn: () => new Promise<void>((done) => { resolve = () => done() }),
          update: (current, { status }) => current?.map((row) => ({ ...row, status })),
        }),
      { wrapper },
    )

    act(() => result.current.mutate({ status: 'done' }))
    await waitFor(() => expect(client.getQueryData(KEY)).toEqual([{ id: '1', status: 'done' }]))
    act(() => resolve?.())
  })

  it('restores exactly what was there when the write fails', async () => {
    const { client, wrapper } = harness()
    const onFailure = vi.fn()

    const { result } = renderHook(
      () =>
        useOptimisticMutation<void, { status: string }, { id: string; status: string }[]>({
          queryKey: KEY,
          mutationFn: () => Promise.reject(new Error('refused')),
          update: (current, { status }) => current?.map((row) => ({ ...row, status })),
          onFailure,
        }),
      { wrapper },
    )

    act(() => result.current.mutate({ status: 'done' }))
    await waitFor(() => expect(onFailure).toHaveBeenCalled())
    expect(client.getQueryData(KEY)).toEqual([{ id: '1', status: 'todo' }])
  })

  it('does not let a refetch land on top of an in-flight change', async () => {
    const { client, wrapper } = harness()
    const cancel = vi.spyOn(client, 'cancelQueries')
    let resolve: (() => void) | null = null

    const { result } = renderHook(
      () =>
        useOptimisticMutation<void, { status: string }, { id: string; status: string }[]>({
          queryKey: KEY,
          mutationFn: () => new Promise<void>((done) => { resolve = () => done() }),
          update: (current, { status }) => current?.map((row) => ({ ...row, status })),
        }),
      { wrapper },
    )

    act(() => result.current.mutate({ status: 'done' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ queryKey: KEY }))
    act(() => resolve?.())
  })

  it('invalidates once the change has settled, whichever way it went', async () => {
    const { client, wrapper } = harness()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(
      () =>
        useOptimisticMutation<void, { status: string }, { id: string; status: string }[]>({
          queryKey: KEY,
          mutationFn: () => Promise.resolve(),
          update: (current, { status }) => current?.map((row) => ({ ...row, status })),
        }),
      { wrapper },
    )

    act(() => result.current.mutate({ status: 'done' }))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY }))
  })
})
