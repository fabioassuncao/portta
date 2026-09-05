// Which task each running environment is being worked in, and why.
//
// Stored links win outright. What is left is inferred from data the panel
// already has — labels, the branch the host scan collected, the namespace —
// with a stated precedence: a label beats a branch, a branch beats a
// namespace. Inside each source the task's own coordinate (`portta.task`,
// `task-42-…`) is read before the GitHub issue coordinate (`portta.issue`,
// `fix/182-…`), which resolves to a task through its binding. An ambiguous
// match links nothing: an automatic link that is wrong is worse than none.

import { taskIdFromBranch, taskIdFromLabel, taskIdFromNamespace, TASK_LABEL } from 'portta-core'
import type { Snapshot } from './inventory.ts'
import { issueFromBranch, issueFromNamespace, parseIssueLabel, type IssueLinkSource } from './issue-link.ts'
import { repositoryCoordinate } from './adoption.ts'
import { readProjectGit } from './git.ts'
import type { PanelConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import type { TaskEnvironmentRow, TaskRow } from '../db/tasks.ts'
import type { StoredIssue } from '../db/github.ts'

export interface ResolvedTaskLink {
  taskId: string
  source: IssueLinkSource
  reason: string
  branch: string | null
}

export interface IssueBinding {
  taskId: string
  githubIssueId: string
}

const REASON: Record<IssueLinkSource, (facts: { branch: string | null; name: string; label: string }) => string> = {
  manual: () => 'linked by hand',
  label: (facts) => `this environment declares ${facts.label}`,
  branch: (facts) => `this environment is on branch ${facts.branch}`,
  namespace: (facts) => `this environment is namespaced ${facts.name}`,
}

/**
 * The pure half: every environment in the snapshot, resolved to at most one
 * task. `stored` rows are authoritative (they came from a person, or from the
 * migration that carried the old issue links across).
 */
export function resolveTaskLinks(input: {
  snapshot: Snapshot
  tasks: readonly Pick<TaskRow, 'id'>[]
  stored: readonly Pick<TaskEnvironmentRow, 'taskId' | 'composeProject' | 'source' | 'branch'>[]
  bindings: readonly IssueBinding[]
  issues: readonly Pick<StoredIssue, 'id' | 'repository' | 'number'>[]
  branches: ReadonlyMap<string, string | null>
}): Map<string, ResolvedTaskLink> {
  const resolved = new Map<string, ResolvedTaskLink>()
  const known = new Set(input.tasks.map((task) => task.id))
  const taskByIssue = new Map(input.bindings.map((binding) => [binding.githubIssueId, binding.taskId]))
  const storedByProject = new Map(input.stored.map((row) => [row.composeProject, row]))

  const taskForIssue = (repository: string | null, number: number): string | null => {
    const candidates = input.issues.filter((issue) =>
      issue.number === number && (repository === null || issue.repository.toLowerCase() === repository.toLowerCase()))
    if (candidates.length !== 1) return null
    const taskId = taskByIssue.get(candidates[0]!.id)
    return taskId && known.has(taskId) ? taskId : null
  }

  for (const environment of input.snapshot.environments) {
    const stored = storedByProject.get(environment.name)
    if (stored && known.has(stored.taskId)) {
      resolved.set(environment.name, {
        taskId: stored.taskId,
        source: stored.source,
        reason: REASON[stored.source]({ branch: stored.branch, name: environment.name, label: TASK_LABEL }),
        branch: stored.branch,
      })
      continue
    }

    const branch = input.branches.get(environment.name) ?? null
    const repository = repositoryCoordinate(environment.repoUrl) ?? environment.repo?.toLowerCase() ?? null
    const labels = environment.services[0]?.labels ?? {}

    let taskId: string | null = null
    let source: IssueLinkSource = 'label'
    let label = TASK_LABEL

    const fromTaskLabel = taskIdFromLabel(labels)
    if (fromTaskLabel && known.has(fromTaskLabel)) {
      taskId = fromTaskLabel
    } else {
      const issueLabel = parseIssueLabel(environment.issueRef ?? null)
      if (issueLabel) {
        taskId = taskForIssue(issueLabel.repository ?? repository, issueLabel.number)
        label = 'portta.issue'
      }
    }
    if (taskId === null) {
      source = 'branch'
      const fromBranch = taskIdFromBranch(branch)
      if (fromBranch && known.has(fromBranch)) taskId = fromBranch
      else {
        const issueNumber = issueFromBranch(branch)
        if (issueNumber !== null && repository !== null) taskId = taskForIssue(repository, issueNumber)
      }
    }
    if (taskId === null) {
      source = 'namespace'
      const fromNamespace = taskIdFromNamespace(environment.namespace) ?? taskIdFromNamespace(environment.name)
      if (fromNamespace && known.has(fromNamespace)) taskId = fromNamespace
      else {
        const issueNumber = issueFromNamespace(environment.namespace) ?? issueFromNamespace(environment.name)
        if (issueNumber !== null && repository !== null) taskId = taskForIssue(repository, issueNumber)
      }
    }
    if (taskId === null) continue
    resolved.set(environment.name, { taskId, source, reason: REASON[source]({ branch, name: environment.name, label }), branch })
  }
  return resolved
}

/** Branches the host scan collected, one read per environment. */
export function branchesOf(config: PanelConfig, snapshot: Snapshot): Map<string, string | null> {
  return new Map(snapshot.environments.map((environment) => [environment.name, readProjectGit(config, environment.name).git?.branch ?? null]))
}

/** Everything `resolveTaskLinks` needs, read once per request. */
export async function loadTaskLinks(config: PanelConfig, db: Database, snapshot: Snapshot, tasks?: readonly TaskRow[]): Promise<Map<string, ResolvedTaskLink>> {
  const corpus = tasks ?? await db.tasks.list({ limit: 2000 })
  const bindings = await db.tasks.listLinks()
  const issues = bindings.length > 0 ? await db.github.listIssues({}) : []
  return resolveTaskLinks({
    snapshot,
    tasks: corpus,
    stored: await db.tasks.listEnvironments(),
    bindings: bindings.map((link) => ({ taskId: link.taskId, githubIssueId: link.githubIssueId })),
    issues,
    branches: branchesOf(config, snapshot),
  })
}
