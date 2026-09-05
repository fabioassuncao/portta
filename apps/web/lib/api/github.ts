// The GitHub App integration, as the panel projects it.

import type {
  GitHubIntegrationView,
  GitHubRepositoryView,
} from 'portta-contracts'
import { request } from './client.ts'

export const githubApi = {
  github: () => request<GitHubIntegrationView>('/integrations/github'),
  githubRepositories: () =>
    request<{ repositories: GitHubRepositoryView[] }>('/integrations/github/repositories').then(
      (data) => data.repositories,
    ),
  syncGitHub: () =>
    request<{ ok: boolean; installations: number; repositories: number; removed: number }>(
      '/integrations/github/sync',
      { method: 'POST', body: '{}' },
    ),
}
