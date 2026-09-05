// Where a projected issue meets the task it is bound to.
//
// The projection (github_issues) stays a cache with an age. What this adds is
// the row in task_github_links and the two directions across it:
//
//   - `applyIssueToTask`: the projection changed (sync, webhook, a write we
//     just made); the bound task follows unless a local edit is pending;
//   - `planIssuePatch`: a local task changed; this is the PATCH GitHub gets,
//     built from the label convention so a status written here reads the
//     same on github.com.
//
// Pure where it can be. The network stays in the routes.

import { reconcileBinding, taskFieldsFromIssue, type TaskStatus } from 'portta-core'
import type { StoredIssue } from '../../../db/github.ts'
import type { TaskGitHubLinkRow, TaskRow, TasksRepository } from '../../../db/tasks.ts'
import { labelsAfter, type Priority, type WorkflowStatus } from './metadata.ts'

export type ApplyOutcome = 'applied' | 'kept' | 'conflict' | 'created' | 'unbound'

function seconds(date: Date | null): number {
  return date ? Math.floor(date.getTime() / 1000) : 0
}

/** The task fields a projected issue implies. Shared with the migration backfill through core. */
export function fieldsFor(issue: StoredIssue) {
  return taskFieldsFromIssue({
    title: issue.title,
    body: issue.body,
    state: issue.state === 'closed' ? 'closed' : 'open',
    workflowStatus: issue.workflowStatus,
    priority: issue.priority,
    issueType: issue.issueType,
    labels: issue.labels,
    assignees: issue.assignees,
    updatedAt: seconds(issue.githubUpdatedAt),
  })
}

/**
 * The projection of `issue` changed. Bring the bound task in step, or create
 * one when the issue is new on a repository a Project owns.
 *
 * `projectFor` answers which Project (and local repository) owns the issue's
 * GitHub repository; null means nobody does, and nothing is created.
 */
export async function applyIssueToTask(
  tasks: TasksRepository,
  issue: StoredIssue,
  projectFor: (githubRepositoryId: string) => Promise<{ projectId: string; repositoryId: string } | null>,
): Promise<{ outcome: ApplyOutcome; task: TaskRow | null }> {
  if (issue.isPullRequest) return { outcome: 'unbound', task: null }
  const existing = await tasks.findByIssue(issue.id)
  if (!existing) {
    const owner = await projectFor(issue.repositoryId)
    if (!owner) return { outcome: 'unbound', task: null }
    const fields = fieldsFor(issue)
    const created = await tasks.create(owner.projectId, {
      title: fields.title,
      description: fields.description,
      status: fields.status,
      priority: fields.priority,
      type: fields.type,
      labels: fields.labels,
      assignee: fields.assignee,
      repositoryId: owner.repositoryId,
    }, 'github')
    await tasks.upsertLink({
      taskId: created.id,
      githubIssueId: issue.id,
      syncState: 'synced',
      lastSyncedAt: issue.syncedAt,
      localUpdatedAt: issue.githubUpdatedAt,
      remoteUpdatedAt: issue.githubUpdatedAt,
    })
    return { outcome: 'created', task: created }
  }

  const link = await tasks.findLink(existing.id)
  if (!link) return { outcome: 'unbound', task: existing }
  const verdict = reconcileBinding(
    { syncState: link.syncState, localUpdatedAt: seconds(link.localUpdatedAt), remoteUpdatedAt: link.remoteUpdatedAt ? seconds(link.remoteUpdatedAt) : null },
    { updatedAt: seconds(issue.githubUpdatedAt) },
  )
  if (verdict === 'keep-local') return { outcome: 'kept', task: existing }
  if (verdict === 'conflict') {
    await tasks.setLinkState(existing.id, 'conflict', { remoteUpdatedAt: issue.githubUpdatedAt, lastError: null })
    return { outcome: 'conflict', task: existing }
  }
  const fields = fieldsFor(issue)
  const updated = await tasks.update(existing.id, {
    title: fields.title,
    description: fields.description,
    status: fields.status,
    priority: fields.priority,
    type: fields.type,
    labels: fields.labels,
    assignee: fields.assignee,
  })
  await tasks.setLinkState(existing.id, 'synced', {
    lastSyncedAt: issue.syncedAt,
    remoteUpdatedAt: issue.githubUpdatedAt,
    localUpdatedAt: issue.githubUpdatedAt,
    lastError: null,
  })
  return { outcome: 'applied', task: updated ?? existing }
}

/**
 * What GitHub is asked to change when a bound task changes locally. Only the
 * dimensions that moved are sent, so a note or a reparent never rewrites an
 * issue's labels.
 */
export function planIssuePatch(
  issue: StoredIssue,
  change: { title?: string; description?: string | null; status?: TaskStatus; priority?: string | null; assignee?: string | null; labels?: string[]; close?: boolean },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (change.title !== undefined && change.title !== issue.title) patch['title'] = change.title
  if (change.description !== undefined && change.description !== issue.body) patch['body'] = change.description ?? ''
  if (change.status !== undefined || change.priority !== undefined || change.labels !== undefined) {
    patch['labels'] = labelsAfter(change.labels ?? issue.labels.filter((label) => !/^(status|priority):/i.test(label)), {
      ...(change.status !== undefined ? { status: change.status as WorkflowStatus } : {}),
      ...(change.priority !== undefined ? { priority: (change.priority ?? null) as Priority | null } : {}),
    })
  }
  if (change.assignee !== undefined) {
    const current = issue.assignees
    patch['assignees'] = change.assignee === null ? [] : current.includes(change.assignee) ? current : [...current, change.assignee]
  }
  if (change.close === true && issue.state !== 'closed') patch['state'] = 'closed'
  if (change.status !== undefined && change.status !== 'done' && issue.state === 'closed') patch['state'] = 'open'
  return patch
}

/** True when a link needs pushing: a local write that never reached GitHub. */
export function needsPush(link: TaskGitHubLinkRow | null): boolean {
  return link !== null && (link.syncState === 'pending' || link.syncState === 'error')
}
