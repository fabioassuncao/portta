// What a composer may use. Named exports, never `export *` from a service:
// this package holds every business rule in the product, and a barrel that
// re-exported all of it would make `apps/web` able to reach past the API into
// anything, which is the boundary this package exists to draw.
//
// A Server Component or an entry point composes these; a route handler inside
// this package still imports its neighbours by relative path.

export { createApi, createApp, type AppDeps } from './api/index.ts'
export { generateOpenApi } from './api/openapi.ts'
export { eventRoutes } from './realtime/sse.ts'
export { createUpgradeHandler, matchPath, NotFound, type UpgradeHandler, type WsRoute } from './realtime/ws/upgrade.ts'
export { logStreamRoute } from './realtime/ws/logs.ts'
export { isProtected, loadConfig, type PanelConfig } from './config.ts'
export { Database, DatabaseUnavailable } from './db/index.ts'
export { DockerClient } from './services/docker/client.ts'
export { LiveHub } from './realtime/hub.ts'
export { createSnapshotCache } from './services/inventory.ts'
export { createVerdictCache } from './services/traefik.ts'
export { GENERATED_FILES, reconcilePanelDynamic } from './services/dynamic.ts'
export { GitHubIntegration } from './services/integrations/github/index.ts'

// The panel's own fixtures derive a service's technology the way the inventory
// does, rather than restating the answer and drifting from it.
export { resolveServiceTech } from './services/tech.ts'

// What a Server Component reads. A page calls these directly; it never fetches
// the API this process is already serving.
export { developmentOverview, listProjects } from './services/development.ts'
export {
  readActivity,
  readProject,
  readProjects,
  readRepositories,
  readRepository,
  readSessions,
  readTask,
  readTasks,
} from './services/reads.ts'
export { panelOverview } from './services/status.ts'
export { readCurrentMetrics } from './services/metrics.ts'

// Background work. The host stays the collector; these are the intervals the
// panel itself owns.
export { createCommitWatch, createMaintenance } from './services/commit-watch.ts'
export {
  createReconciliationSchedule,
  intervalMinutes,
} from './services/integrations/github/sync/schedule.ts'
