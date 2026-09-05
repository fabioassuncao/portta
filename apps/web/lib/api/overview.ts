// The Development Dashboard, and the Development Context an agent reads.

import type { DevelopmentContext, DevelopmentOverview } from 'portta-contracts'
import { request } from './client.ts'

export const overviewApi = {
  developmentOverview: () => request<DevelopmentOverview>('/overview'),
  projectContext: (slug: string, task?: string | null) =>
    request<DevelopmentContext>(`/projects/${encodeURIComponent(slug)}/context${task ? `?task=${encodeURIComponent(task)}` : ''}`),
}
