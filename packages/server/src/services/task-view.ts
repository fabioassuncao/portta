// One task, as the API returns it.
//
// Extracted so the board, the task page, the CLI and an agent cannot answer
// differently about the same row: one set of environments, one binding state,
// one subtask count. Reads rows and the Docker snapshot; makes no network call.

import type { Snapshot } from './inventory.ts'
import { loadTaskLinks, type ResolvedTaskLink } from './task-environments.ts'
import { panelUrlFor } from './issue-environments.ts'
import type { PanelConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import type { TaskAttachmentRow, TaskGitHubLinkRow, TaskNoteRow, TaskRow } from '../db/tasks.ts'
import type { StoredIssue } from '../db/github.ts'
import type { SessionRow } from '../db/work-sessions.ts'
import type { Task, TaskAttachment, TaskEnvironmentLink, TaskGitHubBinding, TaskNote, TaskSummary } from 'portta-contracts'
import { attachmentKind } from './attachments.ts'
import { taskFieldsFromIssue } from 'portta-core'

function seconds(date: Date | null): number | null {
  return date ? Math.floor(date.getTime() / 1000) : null
}

export function taskPanelUrl(slug: string, id: string): string {
  return `#/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(id)}`
}

/** Everything a listing needs, read once. */
export interface TaskContext {
  slugById: Map<string, string>
  repositoryNameById: Map<string, string>
  environmentNameById: Map<string, string>
  tasks: TaskRow[]
  /** How many files each task carries; counted once for the whole listing. */
  attachmentCounts: Map<string, number>
  links: Map<string, TaskGitHubLinkRow>
  issues: Map<string, StoredIssue>
  resolved: Map<string, ResolvedTaskLink>
  snapshot: Snapshot
}

export async function loadTaskContext(config: PanelConfig, db: Database, snapshot: Snapshot, tasks?: TaskRow[]): Promise<TaskContext> {
  const corpus = tasks ?? await db.tasks.list({ limit: 2000 })
  const [projects, repositories, environments, links, attachmentCounts] = await Promise.all([
    db.projects.list(), db.repositories.list(), db.environments.list(), db.tasks.listLinks(),
    db.tasks.countAttachments(corpus.map((task) => task.id)),
  ])
  const issues = new Map<string, StoredIssue>()
  if (links.length > 0) {
    for (const issue of await db.github.listIssues({})) issues.set(issue.id, issue)
  }
  return {
    slugById: new Map(projects.map((project) => [project.id, project.slug])),
    repositoryNameById: new Map(repositories.map((repository) => [repository.id, repository.name])),
    environmentNameById: new Map(environments.map((environment) => [environment.id, environment.composeProject])),
    tasks: corpus,
    attachmentCounts,
    links: new Map(links.map((link) => [link.taskId, link])),
    issues,
    resolved: await loadTaskLinks(config, db, snapshot, corpus),
    snapshot,
  }
}

function bindingSummary(context: TaskContext, row: TaskRow): TaskSummary['github'] {
  const link = context.links.get(row.id)
  const issue = link ? context.issues.get(link.githubIssueId) : undefined
  if (!link || !issue) return null
  return { repository: issue.repository, number: issue.number, htmlUrl: issue.htmlUrl, syncState: link.syncState }
}

export function taskSummary(context: TaskContext, row: TaskRow): TaskSummary {
  const children = context.tasks.filter((task) => task.parentId === row.id)
  const slug = context.slugById.get(row.projectId) ?? row.projectId
  const repositoryName = row.repositoryId ? context.repositoryNameById.get(row.repositoryId) : undefined
  return {
    id: row.id,
    project: slug,
    parentId: row.parentId,
    title: row.title,
    status: row.status,
    priority: row.priority,
    type: row.type,
    labels: row.labels,
    assignee: row.assignee,
    agent: row.agent,
    repository: row.repositoryId && repositoryName !== undefined ? { id: row.repositoryId, name: repositoryName } : null,
    environment: row.environmentId ? context.environmentNameById.get(row.environmentId) ?? null : null,
    service: row.service,
    subtaskCount: children.length,
    openSubtaskCount: children.filter((child) => child.status !== 'done').length,
    github: bindingSummary(context, row),
    dueAt: seconds(row.dueAt),
    draft: row.draft,
    attachmentCount: context.attachmentCounts.get(row.id) ?? 0,
    position: row.position,
    createdAt: seconds(row.createdAt) ?? 0,
    updatedAt: seconds(row.updatedAt) ?? 0,
    closedAt: seconds(row.closedAt),
    panelUrl: taskPanelUrl(slug, row.id),
  }
}

export function taskSummaries(context: TaskContext, rows: readonly TaskRow[]): TaskSummary[] {
  return rows.map((row) => taskSummary(context, row))
}

function binding(context: TaskContext, row: TaskRow): TaskGitHubBinding | null {
  const link = context.links.get(row.id)
  const issue = link ? context.issues.get(link.githubIssueId) : undefined
  if (!link || !issue) return null
  const remote = link.syncState === 'conflict'
    ? (() => {
        const fields = taskFieldsFromIssue({
          title: issue.title, body: issue.body, state: issue.state === 'closed' ? 'closed' : 'open',
          workflowStatus: issue.workflowStatus, priority: issue.priority, issueType: issue.issueType,
          labels: issue.labels, assignees: issue.assignees, updatedAt: seconds(issue.githubUpdatedAt) ?? 0,
        })
        return { title: fields.title, status: fields.status, priority: fields.priority, assignee: fields.assignee }
      })()
    : null
  return {
    repository: issue.repository,
    number: issue.number,
    htmlUrl: issue.htmlUrl,
    state: issue.state === 'closed' ? 'closed' : 'open',
    syncState: link.syncState,
    lastSyncedAt: seconds(link.lastSyncedAt),
    lastError: link.lastError,
    remoteUpdatedAt: seconds(link.remoteUpdatedAt),
    metadataSource: (issue.metadataSource as 'fields' | 'labels' | 'none') ?? 'none',
    remote,
  }
}

export function environmentsOfTask(context: TaskContext, taskId: string): TaskEnvironmentLink[] {
  const out: TaskEnvironmentLink[] = []
  for (const environment of context.snapshot.environments) {
    const link = context.resolved.get(environment.name)
    if (!link || link.taskId !== taskId) continue
    out.push({
      environment: environment.name,
      source: link.source,
      reason: link.reason,
      running: environment.runningCount > 0,
      serviceCount: environment.serviceCount,
      runningCount: environment.runningCount,
      unhealthyCount: environment.unhealthyCount,
      branch: link.branch,
      urls: environment.urls.map((url) => ({ url: url.url, scope: url.scope })),
      panelUrl: panelUrlFor(environment.name),
    })
  }
  return out
}

export function noteView(note: TaskNoteRow): TaskNote {
  return {
    id: note.id, actor: note.actor, actorKind: note.actorKind, body: note.body,
    createdAt: seconds(note.createdAt) ?? 0, updatedAt: seconds(note.updatedAt),
    publishState: note.publishState, githubCommentId: note.githubCommentId,
    githubHtmlUrl: note.githubHtmlUrl, publishError: note.publishError,
  }
}

export function attachmentView(taskId: string, row: TaskAttachmentRow): TaskAttachment {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    kind: attachmentKind(row.contentType),
    actor: row.actor,
    actorKind: row.actorKind,
    createdAt: seconds(row.createdAt) ?? 0,
    // The bytes are behind this URL rather than in the payload: a task with
    // ten screenshots would otherwise be a ten-megabyte JSON response.
    downloadUrl: `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(row.id)}`,
  }
}

export function taskView(
  context: TaskContext,
  row: TaskRow,
  notes: readonly TaskNoteRow[],
  sessions: readonly SessionRow[],
  attachments: readonly TaskAttachmentRow[] = [],
): Task {
  const summary = taskSummary(context, row)
  return {
    ...summary,
    description: row.description,
    createdBy: row.createdBy,
    github: binding(context, row),
    environments: environmentsOfTask(context, row.id),
    notes: notes.map(noteView),
    attachments: attachments.map((attachment) => attachmentView(row.id, attachment)),
    subtasks: taskSummaries(context, context.tasks.filter((task) => task.parentId === row.id)),
    activeSessionCount: sessions.filter((session) => session.status === 'active' && session.taskId === row.id).length,
  }
}
