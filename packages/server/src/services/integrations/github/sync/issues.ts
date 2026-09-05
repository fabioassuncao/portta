// The three sync paths, each independently testable.
//
// `initial` projects a newly authorised repository. `reconcile` is what keeps
// the projection correct without a webhook, using the stored `since` cursor so
// an unchanged issue is never re-fetched. `webhook.ts` handles a delivery.
//
// Sub-issue links are resolved in a second pass, so a child seen before its
// parent is not lost.

import type { GitHubClient } from '../client.ts'
import { fetchIssues, fetchSubIssues, normaliseIssue, visibleLinks, type SubIssueLink } from '../issues.ts'
import type { Database } from '../../../../db/index.ts'
import type { StoredRepository } from '../../../../db/github.ts'
import { applyIssueToTask } from '../tasks.ts'

export interface RepositorySyncResult {
  repository: string
  issues: number
  relationships: number
  /** The `github_updated_at` a later run resumes from. */
  cursor: string | null
}

export function scopeFor(repository: { id: string }): string {
  return `issues:${repository.id}`
}

/**
 * Projects one repository's issues, then their sub-issue links.
 *
 * `since` comes from the stored cursor, so a reconciliation run asks GitHub
 * only for what changed. A run with no cursor is the initial sync; the code
 * path is the same, which is what makes the difference testable rather than
 * structural.
 */
export async function syncRepositoryIssues(
  client: GitHubClient,
  db: Database,
  repository: StoredRepository,
  options: { since?: Date | null; maxPages?: number } = {},
): Promise<RepositorySyncResult> {
  const raw = await fetchIssues(client, repository.installationId, repository.fullName, {
    since: options.since ?? null,
    maxPages: options.maxPages,
  })

  let cursor: string | null = options.since?.toISOString() ?? null
  const numbers = new Set<number>()

  const ownerFor = async (githubRepositoryId: string) => {
    const owner = await db.repositories.findByGitHub(githubRepositoryId)
    return owner ? { projectId: owner.projectId, repositoryId: owner.id } : null
  }
  for (const entry of raw) {
    const record = normaliseIssue(entry, repository.id)
    const id = await db.github.upsertIssue(record)
    // The bound task follows the projection; a new issue on a repository a
    // Project owns becomes a task. A local edit that is pending is kept.
    const stored = await db.github.findIssue(id)
    if (stored) {
      const applied = await applyIssueToTask(db.tasks, stored, ownerFor)
      if (applied.task && applied.outcome !== 'kept' && applied.outcome !== 'unbound') {
        await db.activity.append({
          kind: applied.outcome === 'conflict' ? 'task.conflict' : 'task.synced',
          actorKind: 'system',
          source: 'github',
          projectId: applied.task.projectId,
          taskId: applied.task.id,
          repositoryId: applied.task.repositoryId,
          summary: applied.outcome === 'conflict'
            ? `${repository.fullName}#${record.number} conflicts with local task changes`
            : `${repository.fullName}#${record.number} updated the task from GitHub`,
          data: { outcome: applied.outcome, issue: `${repository.fullName}#${record.number}` },
        })
      }
    }
    numbers.add(record.number)
    const updated = record.githubUpdatedAt.toISOString()
    if (cursor === null || updated > cursor) cursor = updated
  }

  // Second pass: parents may only have arrived in this run.
  const links: SubIssueLink[] = []
  for (const entry of raw) {
    if (entry.pull_request) continue
    if ((entry.sub_issues_summary?.total ?? 0) === 0) continue
    const children = await fetchSubIssues(client, repository.installationId, repository.fullName, entry.number)
    links.push(...children)
  }

  const accepted = visibleLinks(links, numbers)
  const resolved: { parentId: string; childId: string; position: number }[] = []
  for (const link of accepted) {
    const parent = await db.github.findIssueByNumber(repository.id, link.parentNumber)
    const child = await db.github.findIssueByNumber(repository.id, link.childNumber)
    if (!parent || !child) continue
    resolved.push({ parentId: parent.id, childId: child.id, position: link.position })
  }
  if (links.length > 0) await db.github.replaceRelationships(repository.id, resolved)

  await db.github.recordSync(scopeFor(repository), { cursor, error: null })
  return {
    repository: repository.fullName,
    issues: raw.length,
    relationships: resolved.length,
    cursor,
  }
}

/**
 * One bounded pass over every authorised repository.
 *
 * Bounded on purpose: a run that could take an unbounded number of requests
 * would exhaust the rate limit exactly when the projection is most needed.
 * Rate-limit pressure ends the run rather than failing it, and the cursor means
 * the next run picks up where this one stopped.
 */
export async function reconcile(
  client: GitHubClient,
  db: Database,
  options: { maxRepositories?: number } = {},
): Promise<RepositorySyncResult[]> {
  const repositories = await db.github.listRepositories()
  const state = new Map((await db.github.listSyncState()).map((entry) => [entry.scope, entry]))
  const results: RepositorySyncResult[] = []

  for (const repository of repositories.slice(0, options.maxRepositories ?? 25)) {
    if (repository.archived) continue
    const stored = state.get(scopeFor(repository))
    try {
      results.push(
        await syncRepositoryIssues(client, db, repository, {
          since: stored?.cursor ? new Date(stored.cursor) : null,
        }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db.github.recordSync(scopeFor(repository), { cursor: stored?.cursor ?? null, error: message })
      // The budget is shared: one repository exhausting it means the rest would
      // fail too, so the run ends and the next one resumes from the cursor.
      if (message.includes('rate limit')) break
    }
  }

  return results
}
