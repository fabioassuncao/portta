// What the panel can say about the GitHub App without asking GitHub.
//
// Lives beside the integration rather than in a route, because the dashboard,
// the diagnostics and the integrations endpoint all report it, and none of them
// is where it should be decided.

import type { GitHubStatus } from 'portta-contracts'
import type { AppDeps } from '../../../deps.ts'
import { unavailableGitHubStatus } from './index.ts'

export function githubStatus(deps: AppDeps): GitHubStatus {
  return (
    deps.github?.status() ??
    unavailableGitHubStatus(false, 'the GitHub App is not configured', deps.config.githubApiUrl)
  )
}
