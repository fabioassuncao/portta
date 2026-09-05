// Writing a task, and keeping its GitHub binding honest.
//
// A local task is always written locally first. When the task is bound to an
// issue and the App can be used, the same change is written to GitHub and the
// projection is refreshed from GitHub's answer — the binding then says
// `synced`. When the App cannot be used, the local write still happens and the
// binding says `pending` (or `error`, with the reason) until the next sync.
// Nothing here fails a local write because of GitHub. Publishing a task or an
// explicit copy of a local comment is an integration verb and lives in the
// GitHub routes.

import { HTTPException } from 'hono/http-exception'
import { parseTaskRef, type TaskStatus } from 'portta-core'
import type { Database } from '../db/index.ts'
import type { TaskGitHubLinkRow, TaskRow } from '../db/tasks.ts'
import type { StoredIssue } from '../db/github.ts'
import type { GitHubIntegration } from './integrations/github/index.ts'
import { normaliseIssue, type RawIssue } from './integrations/github/issues.ts'
import { planIssuePatch } from './integrations/github/tasks.ts'

/** A task by local id, `#id`, or `owner/repo#n` through its binding. */
export async function resolveTask(db: Database, raw: string): Promise<TaskRow> {
  const ref = parseTaskRef(raw)
  if (!ref) throw new HTTPException(400, { message: `'${raw}' is not a task reference` })
  if (ref.kind === 'id') {
    const task = await db.tasks.find(ref.id)
    if (!task) throw new HTTPException(404, { message: `no task '${ref.id}'` })
    return task
  }
  const repository = await db.github.findRepository(ref.repository)
  const issue = repository ? await db.github.findIssueByNumber(repository.id, ref.number) : null
  if (!issue) throw new HTTPException(404, { message: `no issue '${ref.repository}#${ref.number}' in the projection` })
  const task = await db.tasks.findByIssue(issue.id)
  if (!task) throw new HTTPException(404, { message: `'${ref.repository}#${ref.number}' is projected but bound to no task`, cause: 'link it with POST /api/tasks/:id/github/link' })
  return task
}

export interface TaskChange {
  title?: string
  description?: string | null
  status?: TaskStatus
  priority?: string | null
  assignee?: string | null
  labels?: string[]
  close?: boolean
}

export type PushOutcome = 'synced' | 'pending' | 'error' | 'unbound' | 'nothing'

/**
 * Push one change of a bound task to GitHub, and refresh the projection from
 * the answer. Returns what the binding now says.
 */
export async function pushToGitHub(
  db: Database,
  github: GitHubIntegration | null,
  task: TaskRow,
  link: TaskGitHubLinkRow | null,
  change: TaskChange,
): Promise<PushOutcome> {
  if (!link) return 'unbound'
  const issue = await db.github.findIssue(link.githubIssueId)
  if (!issue) {
    await db.tasks.setLinkState(task.id, 'error', { lastError: 'the bound issue is no longer projected' })
    return 'error'
  }
  const patch = planIssuePatch(issue, change)
  if (Object.keys(patch).length === 0) return 'nothing'
  if (github === null || !github.status().configured) {
    await db.tasks.setLinkState(task.id, 'pending', { lastError: null, localUpdatedAt: new Date() })
    return 'pending'
  }
  const repository = await db.github.findRepository(issue.repository)
  if (!repository) {
    await db.tasks.setLinkState(task.id, 'error', { lastError: `${issue.repository} is not a repository this gateway was granted` })
    return 'error'
  }
  try {
    const updated = await github.require().patchAsInstallation<RawIssue>(
      repository.installationId,
      `/repos/${issue.repository}/issues/${issue.number}`,
      patch,
    )
    const record = normaliseIssue(updated.data, issue.repositoryId)
    await db.github.upsertIssue(record)
    await db.tasks.setLinkState(task.id, 'synced', {
      lastError: null,
      lastSyncedAt: new Date(),
      remoteUpdatedAt: record.githubUpdatedAt,
      localUpdatedAt: record.githubUpdatedAt,
    })
    return 'synced'
  } catch (error) {
    await db.tasks.setLinkState(task.id, 'error', {
      lastError: error instanceof Error ? error.message : String(error),
      localUpdatedAt: new Date(),
    })
    return 'error'
  }
}

/** The change a local task carries, as GitHub should see it. Used by sync to push a pending edit whole. */
export function wholeChange(task: TaskRow, issue: StoredIssue): TaskChange {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    labels: task.labels,
    close: task.status === 'done' && issue.state !== 'closed',
  }
}
