// Joining the projection with what is actually running.
//
// An issue reaches an environment through the task it is bound to: the task
// is what environments are linked to (task-environments.ts), and the binding
// says which issue that task is. So `Issue.environments` and the deprecated
// `Environment.issue` are both views over one resolution, never a second one.

import type { Snapshot } from './inventory.ts'
import type { IssueLinkSource } from './issue-link.ts'
import type { ResolvedTaskLink } from './task-environments.ts'
import type { StoredIssue } from '../db/github.ts'
import type { Environment, EnvironmentIssue, EnvironmentTask, IssueEnvironment } from 'portta-contracts'
import type { TaskRow } from '../db/tasks.ts'

export interface ResolvedLink {
  issueId: string
  taskId: string
  source: IssueLinkSource
  reason: string
  branch: string | null
}

export function panelUrlFor(project: string): string {
  return `#/environments/${encodeURIComponent(project)}`
}

export function logsUrlFor(project: string): string {
  return `${panelUrlFor(project)}/logs`
}

/** The task links, keyed by environment, narrowed to the tasks that are bound to an issue. */
export function issueLinksFrom(
  resolved: ReadonlyMap<string, ResolvedTaskLink>,
  bindings: ReadonlyArray<{ taskId: string; githubIssueId: string }>,
): Map<string, ResolvedLink> {
  const issueByTask = new Map(bindings.map((binding) => [binding.taskId, binding.githubIssueId]))
  const out = new Map<string, ResolvedLink>()
  for (const [environment, link] of resolved) {
    const issueId = issueByTask.get(link.taskId)
    if (issueId) out.set(environment, { ...link, issueId })
  }
  return out
}

export function environmentsFor(
  issueId: string,
  snapshot: Snapshot,
  links: ReadonlyMap<string, ResolvedLink>,
): IssueEnvironment[] {
  const out: IssueEnvironment[] = []
  for (const project of snapshot.environments) {
    const link = links.get(project.name)
    if (!link || link.issueId !== issueId) continue
    out.push({
      project: project.name,
      source: link.source,
      reason: link.reason,
      running: project.runningCount > 0,
      serviceCount: project.serviceCount,
      runningCount: project.runningCount,
      unhealthyCount: project.unhealthyCount,
      urls: project.urls,
      branch: link.branch,
      panelUrl: panelUrlFor(project.name),
      logsUrl: logsUrlFor(project.name),
    })
  }
  return out
}

export function issueForEnvironment(
  project: Environment,
  issues: ReadonlyArray<StoredIssue>,
  links: ReadonlyMap<string, ResolvedLink>,
): EnvironmentIssue | null {
  const link = links.get(project.name)
  if (!link) return null
  const issue = issues.find((entry) => entry.id === link.issueId)
  if (!issue) return null

  return {
    id: issue.id,
    repository: issue.repository,
    number: issue.number,
    title: issue.title,
    state: issue.state === 'closed' ? 'closed' : 'open',
    issueType: issue.issueType,
    status: issue.workflowStatus,
    priority: issue.priority,
    source: link.source,
    reason: link.reason,
    htmlUrl: issue.htmlUrl,
    panelUrl: `#/issues/${encodeURIComponent(issue.id)}`,
    syncedAt: Math.floor(issue.syncedAt.getTime() / 1000),
  }
}

export function taskForEnvironment(
  project: Environment,
  tasks: ReadonlyArray<TaskRow>,
  slugById: ReadonlyMap<string, string>,
  links: ReadonlyMap<string, ResolvedTaskLink>,
  issueLinks: ReadonlyMap<string, ResolvedLink>,
  issues: ReadonlyArray<StoredIssue>,
): EnvironmentTask | null {
  const link = links.get(project.name)
  if (!link) return null
  const task = tasks.find((entry) => entry.id === link.taskId)
  if (!task) return null
  const slug = slugById.get(task.projectId) ?? task.projectId
  const issueId = issueLinks.get(project.name)?.issueId
  const issue = issueId ? issues.find((entry) => entry.id === issueId) : undefined
  return {
    id: task.id,
    project: slug,
    title: task.title,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    agent: task.agent,
    source: link.source,
    reason: link.reason,
    panelUrl: `#/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(task.id)}`,
    github: issue ? { repository: issue.repository, number: issue.number, htmlUrl: issue.htmlUrl } : null,
  }
}
