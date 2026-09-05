// The contract for Portta's own work model: tasks, sessions and activity.
// Zod is the single source of truth, as in types.ts; kept in its own file so
// the work model can grow without the infrastructure contract moving.

import { z } from 'zod'
import { ACTIVITY_KINDS, ACTIVITY_SOURCES, TASK_PRIORITIES, TASK_STATUSES, TASK_SYNC_STATES } from 'portta-core/browser'

const named = <T extends z.ZodType>(schema: T, ref: string): T => schema.meta({ ref }) as T
const unixSeconds = z.number().describe('Unix timestamp in seconds')

export const TaskStatus = named(z.enum(TASK_STATUSES), 'TaskStatus')
export type TaskStatus = z.infer<typeof TaskStatus>

export const TaskPriority = named(z.enum(TASK_PRIORITIES), 'TaskPriority')
export type TaskPriority = z.infer<typeof TaskPriority>

export const TaskSyncState = named(z.enum(TASK_SYNC_STATES), 'TaskSyncState')
export type TaskSyncState = z.infer<typeof TaskSyncState>

export const ActorKind = named(z.enum(['human', 'agent', 'system']), 'ActorKind')
export type ActorKind = z.infer<typeof ActorKind>

/** The GitHub issue a task is bound to, when it is. */
export const TaskGitHubBinding = named(
  z.object({
    repository: z.string().describe('owner/name'),
    number: z.number().int(),
    htmlUrl: z.string(),
    state: z.enum(['open', 'closed']),
    syncState: TaskSyncState,
    lastSyncedAt: unixSeconds.nullable(),
    lastError: z.string().nullable(),
    remoteUpdatedAt: unixSeconds.nullable(),
    metadataSource: z.enum(['fields', 'labels', 'none']).describe('How status and priority are written on GitHub'),
    /** What GitHub has, when the local row disagrees with it. */
    remote: z.object({
      title: z.string(),
      status: TaskStatus.nullable(),
      priority: TaskPriority.nullable(),
      assignee: z.string().nullable(),
    }).strict().nullable(),
  }).strict(),
  'TaskGitHubBinding',
)
export type TaskGitHubBinding = z.infer<typeof TaskGitHubBinding>

export const TaskEnvironmentLink = named(
  z.object({
    environment: z.string().describe('COMPOSE_PROJECT_NAME'),
    source: z.enum(['manual', 'label', 'branch', 'namespace']),
    reason: z.string(),
    running: z.boolean(),
    serviceCount: z.number().int(),
    runningCount: z.number().int(),
    unhealthyCount: z.number().int(),
    branch: z.string().nullable(),
    urls: z.array(z.object({ url: z.string(), scope: z.string() }).strict()),
    panelUrl: z.string(),
  }).strict(),
  'TaskEnvironmentLink',
)
export type TaskEnvironmentLink = z.infer<typeof TaskEnvironmentLink>

export const TaskSummary = named(
  z.object({
    id: z.string(),
    project: z.string().describe('Project slug'),
    parentId: z.string().nullable(),
    title: z.string(),
    status: TaskStatus,
    priority: TaskPriority.nullable(),
    type: z.string().nullable(),
    labels: z.array(z.string()),
    assignee: z.string().nullable(),
    agent: z.string().nullable(),
    repository: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
    environment: z.string().nullable().describe('COMPOSE_PROJECT_NAME the task is scoped to, when it is'),
    service: z.string().nullable(),
    subtaskCount: z.number().int(),
    openSubtaskCount: z.number().int(),
    github: z.object({ repository: z.string(), number: z.number().int(), htmlUrl: z.string(), syncState: TaskSyncState }).strict().nullable(),
    dueAt: unixSeconds.nullable(),
    draft: z.boolean(),
    attachmentCount: z.number().int(),
    position: z.number().int(),
    createdAt: unixSeconds,
    updatedAt: unixSeconds,
    closedAt: unixSeconds.nullable(),
    panelUrl: z.string(),
  }).strict(),
  'TaskSummary',
)
export type TaskSummary = z.infer<typeof TaskSummary>

export const TaskNote = named(
  z.object({
    id: z.string(),
    actor: z.string().nullable(),
    actorKind: ActorKind,
    body: z.string(),
    createdAt: unixSeconds,
    updatedAt: unixSeconds.nullable(),
    publishState: z.enum(['local', 'pending', 'synced', 'error']),
    githubCommentId: z.number().int().nullable(),
    githubHtmlUrl: z.string().nullable(),
    publishError: z.string().nullable(),
  }).strict(),
  'TaskNote',
)
export type TaskNote = z.infer<typeof TaskNote>
export const TaskComment = TaskNote
export type TaskComment = TaskNote

/**
 * A file attached to a task: a screenshot, a log, the JSON that reproduces it.
 * The bytes are never in an API response body — `downloadUrl` is where they
 * are, so a listing stays a listing.
 */
export const TaskAttachment = named(
  z.object({
    id: z.string(),
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number().int(),
    /** How the panel may present it: inline, as text, as a PDF, or as a download only. */
    kind: z.enum(['image', 'text', 'pdf', 'file']),
    actor: z.string().nullable(),
    actorKind: ActorKind,
    createdAt: unixSeconds,
    downloadUrl: z.string(),
  }).strict(),
  'TaskAttachment',
)
export type TaskAttachment = z.infer<typeof TaskAttachment>

export const Task = named(
  TaskSummary.extend({
    description: z.string().nullable(),
    createdBy: z.string().nullable(),
    github: TaskGitHubBinding.nullable(),
    environments: z.array(TaskEnvironmentLink),
    notes: z.array(TaskNote),
    attachments: z.array(TaskAttachment),
    subtasks: z.array(TaskSummary),
    activeSessionCount: z.number().int(),
  }).strict(),
  'Task',
)
export type Task = z.infer<typeof Task>

export const SessionStatus = named(z.enum(['active', 'ended', 'abandoned']), 'SessionStatus')
export type SessionStatus = z.infer<typeof SessionStatus>

export const Session = named(
  z.object({
    id: z.string(),
    project: z.string().describe('Project slug'),
    task: z.object({ id: z.string(), title: z.string(), status: TaskStatus }).strict().nullable(),
    repository: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
    environment: z.string().nullable(),
    actor: z.string(),
    actorKind: z.enum(['human', 'agent']),
    agent: z.string().nullable(),
    status: SessionStatus,
    startedAt: unixSeconds,
    lastActivityAt: unixSeconds,
    endedAt: unixSeconds.nullable(),
    summary: z.string().nullable(),
    headBefore: z.string().nullable(),
    headAfter: z.string().nullable(),
    commits: z.array(z.object({ sha: z.string(), subject: z.string(), at: unixSeconds }).strict()),
  }).strict(),
  'Session',
)
export type Session = z.infer<typeof Session>

export const ActivityKind = named(z.enum(ACTIVITY_KINDS), 'ActivityKind')
export type ActivityKind = z.infer<typeof ActivityKind>
export const ActivitySource = named(z.enum(ACTIVITY_SOURCES), 'ActivitySource')
export type ActivitySource = z.infer<typeof ActivitySource>

export const ActivityEvent = named(
  z.object({
    id: z.string(),
    at: unixSeconds,
    kind: ActivityKind,
    actor: z.string().nullable(),
    actorKind: ActorKind.nullable(),
    source: ActivitySource.nullable(),
    summary: z.string(),
    project: z.string().nullable().describe('Project slug'),
    taskId: z.string().nullable(),
    taskTitle: z.string().nullable(),
    repositoryId: z.string().nullable(),
    repositoryName: z.string().nullable(),
    environment: z.string().nullable().describe('COMPOSE_PROJECT_NAME'),
    sessionId: z.string().nullable(),
    data: z.record(z.string(), z.unknown()),
  }).strict(),
  'ActivityEvent',
)
export type ActivityEvent = z.infer<typeof ActivityEvent>
