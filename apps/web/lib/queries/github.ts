'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '../api/index.ts'
import { keys } from './keys.ts'

export function useGitHub() {
  return useQuery({ queryKey: keys.github(), queryFn: api.github, retry: false })
}

export function useGitHubRepositories() {
  return useQuery({ queryKey: keys.githubRepositories(), queryFn: api.githubRepositories, retry: false })
}
