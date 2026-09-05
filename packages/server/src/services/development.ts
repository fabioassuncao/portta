// The development surfaces, composed.
//
// `GET /api/overview/development` and the panel's Overview page ask for the
// same thing, and neither is allowed to be the place it is assembled: a Server
// Component that fetched its own API would leave the process to reach code it
// already has, and a route handler that assembled it would be the only way to
// get it.
//
// Nothing here is a new source of truth. It reads what the others already read
// — the snapshot, the catalog, the tasks, the scans, the metrics — and hands it
// to a pure presenter, where the shape is tested.

import type { Project, RepositoryGit, DevelopmentOverview } from 'portta-contracts'
import type { AppDeps } from '../deps.ts'
import type { Principal } from 'portta-auth-core'
import { adoptions, projectScope, visible } from './access-control.ts'
import type { Database } from '../db/index.ts'
import { loadProjectCatalog, toProject } from './catalog.ts'
import { applyOverrides, loadAliases, loadOverrides } from './overrides.ts'
import { readCurrentMetrics } from './metrics.ts'
import { readRepositoryScan } from './git.ts'
import { loadTaskContext, taskSummaries } from './task-view.ts'
import { loadNames, sessionView } from './activity-view.ts'
import { buildOverview } from './overview-view.ts'
import { diagnose, problemsOnly } from './diagnostics.ts'
import { gatewayStatus } from './gateway.ts'
import { listShares } from './shares.ts'
import { githubStatus } from './integrations/github/status.ts'

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

/** Every Project the operator has, with the repositories and environments it holds. */
export async function listProjects(deps: AppDeps, db: Database): Promise<Project[]> {
  const snapshot = await deps.cache.get()
  const catalog = await loadProjectCatalog(db, snapshot, deps.config)
  return catalog.records.map((record) =>
    toProject(
      record,
      catalog.repositoriesByProject.get(record.id) ?? [],
      catalog.environments.get(record.id) ?? [],
      catalog.projectsHome,
    ),
  )
}

/** The host scan for every repository these Projects registered, read once each. */
export function scansFor(deps: AppDeps, list: readonly Project[]): Map<string, RepositoryGit> {
  const scans = new Map<string, RepositoryGit>()
  for (const project of list) {
    for (const repository of project.repositories) {
      if (repository.scanKey && !scans.has(repository.scanKey)) {
        scans.set(repository.scanKey, readRepositoryScan(deps.config, repository.scanKey))
      }
    }
  }
  return scans
}

/**
 * The dashboard: the host, the work, who is on it, what needs attention, what
 * changed. With persistence unreachable it still answers — the gateway's own
 * status and nothing invented.
 */
/**
 * The dashboard, for one principal.
 *
 * It sums what that person can see and nothing else: a developer's Overview is
 * their Projects, their environments and their tasks. Totals that included a
 * Project they cannot open would be a number they could not explain.
 */
export async function developmentOverview(deps: AppDeps, principal: Principal): Promise<DevelopmentOverview> {
  const snapshot = await deps.cache.get()
  const overrides = await loadOverrides(deps.db)
  const owners = await adoptions(deps.db)
  const environments = visible(
    principal,
    applyOverrides(snapshot.environments, overrides),
    (environment) => owners.get(environment.name) ?? null,
  )
  const metrics = readCurrentMetrics(deps.config)
  const shares = listShares(deps.config, snapshot)
  const gateway = gatewayStatus(snapshot, deps.config)
  const problems = problemsOnly(
    diagnose(
      snapshot,
      deps.config,
      null,
      shares,
      deps.db.status(),
      loadAliases(deps.config),
      githubStatus(deps),
    ),
  )

  let list: Project[] = []
  let tasks: Awaited<ReturnType<typeof taskSummaries>> = []
  let sessions: ReturnType<typeof sessionView>[] = []
  const lastActivity = new Map<string, { at: number; summary: string }>()

  if (deps.db.status().available) {
    const db = deps.db
    list = visible(principal, await listProjects(deps, db), (project) => projectScope(project.id))
    const rows = visible(principal, await db.tasks.list({ limit: 2000 }), (row) => projectScope(row.projectId))
    tasks = taskSummaries(await loadTaskContext(deps.config, db, snapshot, rows), rows)
    const names = await loadNames(db)
    const active = await db.sessions.list({ status: ['active'], limit: 100 })
    sessions = visible(principal, active, (row) => projectScope(row.projectId)).map((row) => sessionView(names, row))
    for (const event of visible(principal, await db.activity.list({ limit: 300 }), (row) => projectScope(row.projectId))) {
      const slug = event.projectId ? names.slugById.get(event.projectId) : undefined
      if (slug && !lastActivity.has(slug)) lastActivity.set(slug, { at: seconds(event.at), summary: event.summary })
    }
  }

  return buildOverview({
    now: Date.now(),
    projects: list,
    environments,
    tasks,
    sessions,
    scans: scansFor(deps, list),
    metrics,
    problems,
    gatewayUp: gateway.up,
    lastActivity,
  })
}
