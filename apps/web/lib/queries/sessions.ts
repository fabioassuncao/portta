'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '../api/index.ts'
import { keys } from './keys.ts'

export function useSessions(slug: string, filters: { active?: boolean; task?: string } = {}, enabled = true) {
  const normalised = { active: filters.active ? '1' : undefined, task: filters.task }
  return useQuery({ queryKey: keys.sessions(slug, normalised), queryFn: () => api.sessions(slug, filters), retry: false, enabled })
}
