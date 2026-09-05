// One issue, as the API returns it.
//
// Extracted so the issue routes and the task binding cannot answer differently
// about the same row: one staleness flag, one metadata source and one set of
// environments, the last of which comes from the task the issue is bound to.

import type { StoredIssue } from '../db/github.ts'
import type { Database } from '../db/index.ts'
import type { PanelConfig } from '../config.ts'
import type { Snapshot } from './inventory.ts'
import type { Issue } from 'portta-contracts'
import type { Priority, WorkflowStatus } from './integrations/github/metadata.ts'
import { environmentsFor, issueLinksFrom, type ResolvedLink } from './issue-environments.ts'
import { loadTaskLinks } from './task-environments.ts'

/** Past this age the projection is marked stale. It is still shown. */
export const STALE_AFTER_SECONDS = 900

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

export function issueView(
  issue: StoredIssue,
  relationships: { parentId: string; childId: string }[],
  now: number,
  environments: Issue['environments'] = [],
): Issue {
  const syncedAt = seconds(issue.syncedAt)
  return {
    id: issue.id,
    repository: issue.repository,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state === 'closed' ? 'closed' : 'open',
    stateReason: issue.stateReason,
    issueType: issue.issueType,
    status: issue.workflowStatus === null ? null : (issue.workflowStatus as WorkflowStatus),
    priority: issue.priority === null ? null : (issue.priority as Priority),
    metadataSource: (issue.metadataSource as 'fields' | 'labels' | 'none') ?? 'none',
    labels: issue.labels,
    assignees: issue.assignees,
    milestone: issue.milestone,
    htmlUrl: issue.htmlUrl,
    parentId: relationships.find((link) => link.childId === issue.id)?.parentId ?? null,
    childIds: relationships.filter((link) => link.parentId === issue.id).map((link) => link.childId),
    githubUpdatedAt: seconds(issue.githubUpdatedAt),
    syncedAt,
    stale: now - syncedAt > STALE_AFTER_SECONDS,
    environments,
  }
}

/**
 * Where each running environment belongs, resolved once per request, through
 * the tasks and their bindings. Nothing here runs a command or a network call.
 */
export async function resolvedLinks(
  config: PanelConfig,
  db: Database,
  snapshot: Snapshot,
): Promise<Map<string, ResolvedLink>> {
  const resolved = await loadTaskLinks(config, db, snapshot)
  return issueLinksFrom(resolved, await db.tasks.listLinks())
}

/** Assemble several issues in one pass: links and snapshot read once for the set. */
export async function issueViews(
  config: PanelConfig,
  db: Database,
  snapshot: Snapshot,
  issues: StoredIssue[],
): Promise<Issue[]> {
  const relationships = await db.github.listRelationships()
  const links = await resolvedLinks(config, db, snapshot)
  const now = Math.floor(Date.now() / 1000)
  return issues.map((issue) => issueView(issue, relationships, now, environmentsFor(issue.id, snapshot, links)))
}
