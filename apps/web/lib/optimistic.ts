'use client'

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'

/**
 * A mutation that shows its result before the server confirms it, and takes it
 * back visibly when the server refuses.
 *
 * Introduced once and tested once: the board's move uses it, and so does any
 * later mutation that needs the same shape. The rule it encodes — snapshot,
 * apply a pure updater, restore on error, invalidate on settle — is written
 * down here rather than rediscovered as a flicker later.
 *
 * Live invalidation from `useLive()` is applied on settle, so a Docker or
 * GitHub event arriving mid-flight cannot overwrite the optimistic value with
 * a stale one and then be overwritten again.
 */
export function useOptimisticMutation<TData, TVariables, TSnapshot>({
  queryKey,
  mutationFn,
  update,
  onFailure,
}: {
  queryKey: QueryKey
  mutationFn: (variables: TVariables) => Promise<TData>
  /** Pure: given the current cache value and the variables, return the next. */
  update: (current: TSnapshot | undefined, variables: TVariables) => TSnapshot | undefined
  onFailure?: (error: unknown, variables: TVariables) => void
}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn,
    onMutate: async (variables: TVariables) => {
      // In-flight refetches would land after the optimistic write and undo it.
      await queryClient.cancelQueries({ queryKey })
      const snapshot = queryClient.getQueryData<TSnapshot>(queryKey)
      queryClient.setQueryData<TSnapshot>(queryKey, (current) => update(current, variables))
      return { snapshot }
    },
    onError: (error, variables, context) => {
      // Restore exactly what was there, rather than refetching and hoping.
      queryClient.setQueryData<TSnapshot>(queryKey, (context as { snapshot?: TSnapshot } | undefined)?.snapshot)
      onFailure?.(error, variables)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
}
