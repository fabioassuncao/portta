// The panel's API client, in one object, so a page imports one name and a test
// mocks one module. The pieces live beside the entity they serve.

import { activityApi } from './activity.ts'
import { adminApi } from './admin.ts'
import { environmentsApi } from './environments.ts'
import { githubApi } from './github.ts'
import { infraApi } from './infra.ts'
import { overviewApi } from './overview.ts'
import { projectsApi } from './projects.ts'
import { repositoriesApi } from './repositories.ts'
import { sessionsApi } from './sessions.ts'
import { tasksApi } from './tasks.ts'

export { ApiError, request } from './client.ts'
export type { CreateRepositoryBody, PatchRepositoryBody, RepositoryEnvironmentRow } from './repositories.ts'
export type { SubtaskNode, TaskBody, TaskFilters } from './tasks.ts'
export type { ActivityFilters, ActivityPage } from './activity.ts'
export type { AuditFilters } from './admin.ts'
export type { SessionBody } from './sessions.ts'

export const api = {
  ...infraApi,
  ...projectsApi,
  ...environmentsApi,
  ...repositoriesApi,
  ...githubApi,
  ...tasksApi,
  ...sessionsApi,
  ...activityApi,
  ...overviewApi,
  ...adminApi,
}

export type Api = typeof api
