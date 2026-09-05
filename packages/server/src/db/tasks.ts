// Tasks: Portta's own unit of work, and the optional binding to a GitHub issue.
//
// Every id crosses this boundary as a string and every timestamp as a Date; the
// routes decide how they are presented.

import { z } from 'zod'
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import {
  isIntactDraft,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_SYNC_STATES,
  type TaskPriority,
  type TaskStatus,
  type TaskSyncState,
} from 'portta-core'
import {
  type Db,
  environments,
  taskAttachments,
  taskEnvironments,
  taskGithubLinks,
  taskNotes,
  tasks,
} from 'portta-db'

export interface TaskRow {
  id: string
  projectId: string
  repositoryId: string | null
  environmentId: string | null
  service: string | null
  parentId: string | null
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority | null
  type: string | null
  labels: string[]
  assignee: string | null
  agent: string | null
  createdBy: string | null
  position: number
  dueAt: Date | null
  sourceKey: string | null
  draft: boolean
  createdAt: Date
  updatedAt: Date
  closedAt: Date | null
}

export interface TaskNoteRow {
  id: string
  taskId: string
  actor: string | null
  actorKind: 'human' | 'agent' | 'system'
  body: string
  sourceKey: string | null
  createdAt: Date
  updatedAt: Date | null
  githubCommentId: number | null
  githubHtmlUrl: string | null
  publishState: 'local' | 'pending' | 'synced' | 'error'
  publishError: string | null
}

/**
 * An attachment's metadata. The bytes are deliberately not on this row: every
 * listing would carry megabytes it never uses, so `readAttachment` is a
 * separate, explicit read.
 */
export interface TaskAttachmentRow {
  id: string
  taskId: string
  filename: string
  contentType: string
  sizeBytes: number
  actor: string | null
  actorKind: 'human' | 'agent' | 'system'
  createdAt: Date
}

export interface TaskGitHubLinkRow {
  taskId: string
  githubIssueId: string
  syncState: TaskSyncState
  lastSyncedAt: Date | null
  lastError: string | null
  localUpdatedAt: Date
  remoteUpdatedAt: Date | null
}

export interface TaskEnvironmentRow {
  taskId: string
  environmentId: string
  composeProject: string
  source: 'manual' | 'label' | 'branch' | 'namespace'
  branch: string | null
  linkedAt: Date
}

const Actor = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/)
const Labels = z.array(z.string().min(1).max(64)).max(32)

export const CreateTask = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(65536).nullable().default(null),
  status: z.enum(TASK_STATUSES).default('backlog'),
  priority: z.enum(TASK_PRIORITIES).nullable().default(null),
  type: z.string().max(32).nullable().default(null),
  labels: Labels.default([]),
  assignee: Actor.nullable().default(null),
  agent: Actor.nullable().default(null),
  parentId: z.string().min(1).max(64).nullable().default(null),
  repositoryId: z.string().min(1).max(64).nullable().default(null),
  environmentId: z.string().min(1).max(64).nullable().default(null),
  service: z.string().max(64).nullable().default(null),
  dueAt: z.coerce.date().nullable().default(null),
  sourceKey: z.string().min(1).max(80).nullable().default(null),
  draft: z.boolean().default(false),
}).strict()
export type CreateTaskInput = z.infer<typeof CreateTask>

export const UpdateTask = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(65536).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).nullable().optional(),
  type: z.string().max(32).nullable().optional(),
  labels: Labels.optional(),
  assignee: Actor.nullable().optional(),
  agent: Actor.nullable().optional(),
  parentId: z.string().min(1).max(64).nullable().optional(),
  repositoryId: z.string().min(1).max(64).nullable().optional(),
  environmentId: z.string().min(1).max(64).nullable().optional(),
  service: z.string().max(64).nullable().optional(),
  position: z.number().int().min(0).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  sourceKey: z.string().min(1).max(80).nullable().optional(),
  draft: z.boolean().optional(),
}).strict()
export type UpdateTaskInput = z.infer<typeof UpdateTask>

export interface TaskFilter {
  projectId?: string
  repositoryId?: string
  environmentId?: string
  status?: TaskStatus[]
  assignee?: string
  agent?: string
  priority?: TaskPriority[]
  type?: string
  label?: string
  service?: string
  parentId?: string | null
  open?: boolean
  q?: string
  draft?: boolean
  createdBy?: string | null
  sourceKey?: string
  limit?: number
}

type Row = typeof tasks.$inferSelect
type NoteRow = typeof taskNotes.$inferSelect
type AttachmentRow = typeof taskAttachments.$inferSelect
type LinkRow = typeof taskGithubLinks.$inferSelect

const id = (value: string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value)

function toTask(row: Row): TaskRow {
  return {
    ...row,
    id: String(row.id),
    projectId: String(row.projectId),
    repositoryId: row.repositoryId === null ? null : String(row.repositoryId),
    environmentId: row.environmentId === null ? null : String(row.environmentId),
    parentId: row.parentId === null ? null : String(row.parentId),
    labels: Array.isArray(row.labels) ? row.labels.map(String) : [],
    position: Number(row.position),
    draft: Boolean(row.draft),
  }
}

function toNote(row: NoteRow): TaskNoteRow {
  return { ...row, id: String(row.id), taskId: String(row.taskId) }
}

function toAttachment(row: Omit<AttachmentRow, 'content' | 'userId'>): TaskAttachmentRow {
  return { ...row, id: String(row.id), taskId: String(row.taskId), sizeBytes: Number(row.sizeBytes) }
}

function toLink(row: LinkRow): TaskGitHubLinkRow {
  return { ...row, taskId: String(row.taskId), githubIssueId: String(row.githubIssueId) }
}

/** Metadata only. Selecting `content` in a listing would carry megabytes nothing reads. */
const ATTACHMENT_COLUMNS = {
  id: taskAttachments.id,
  taskId: taskAttachments.taskId,
  filename: taskAttachments.filename,
  contentType: taskAttachments.contentType,
  sizeBytes: taskAttachments.sizeBytes,
  actor: taskAttachments.actor,
  actorKind: taskAttachments.actorKind,
  createdAt: taskAttachments.createdAt,
} as const

/**
 * The board's per-column lock. Two writers appending to one column would
 * otherwise compute the same rank from the same `max(position)`.
 */
const boardLock = (projectId: number | string, status: TaskStatus) =>
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${`task-board:${projectId}:${status}`}, 0))`

export class TasksRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async list(filter: TaskFilter = {}): Promise<TaskRow[]> {
    const where = [
      filter.projectId ? eq(tasks.projectId, Number(filter.projectId)) : undefined,
      filter.repositoryId ? eq(tasks.repositoryId, Number(filter.repositoryId)) : undefined,
      filter.environmentId ? eq(tasks.environmentId, Number(filter.environmentId)) : undefined,
      filter.status && filter.status.length > 0 ? inArray(tasks.status, filter.status) : undefined,
      filter.priority && filter.priority.length > 0 ? inArray(tasks.priority, filter.priority) : undefined,
      filter.assignee ? eq(tasks.assignee, filter.assignee) : undefined,
      filter.agent ? eq(tasks.agent, filter.agent) : undefined,
      filter.type ? eq(tasks.type, filter.type) : undefined,
      filter.label ? sql`${tasks.labels} @> ${JSON.stringify([filter.label])}::jsonb` : undefined,
      filter.service ? eq(tasks.service, filter.service) : undefined,
      filter.parentId === null
        ? isNull(tasks.parentId)
        : filter.parentId
          ? eq(tasks.parentId, Number(filter.parentId))
          : undefined,
      filter.open === true
        ? sql`${tasks.status} <> 'done'`
        : filter.open === false
          ? eq(tasks.status, 'done')
          : undefined,
      filter.draft === undefined ? undefined : eq(tasks.draft, filter.draft),
      // `IS NOT DISTINCT FROM` so a filter of `null` means "created by nobody
      // the panel knows", which `= NULL` would never match.
      filter.createdBy !== undefined
        ? sql`${tasks.createdBy} IS NOT DISTINCT FROM ${filter.createdBy}`
        : undefined,
      filter.sourceKey ? eq(tasks.sourceKey, filter.sourceKey) : undefined,
      filter.q
        ? or(ilike(tasks.title, `%${filter.q}%`), ilike(tasks.description, `%${filter.q}%`))
        : undefined,
    ].filter((clause) => clause !== undefined)

    const rows = await this.db
      .select()
      .from(tasks)
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(asc(tasks.position), desc(tasks.updatedAt), asc(tasks.id))
      .limit(Math.min(Math.max(filter.limit ?? 500, 1), 2000))
    return rows.map(toTask)
  }

  async find(taskId: string): Promise<TaskRow | null> {
    if (!/^\d+$/.test(taskId)) return null
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, Number(taskId)))
    return row ? toTask(row) : null
  }

  async findByIssue(githubIssueId: string): Promise<TaskRow | null> {
    if (!/^\d+$/.test(githubIssueId)) return null
    const [row] = await this.db
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(taskGithubLinks, eq(taskGithubLinks.taskId, tasks.id))
      .where(eq(taskGithubLinks.githubIssueId, Number(githubIssueId)))
    return row ? toTask(row.task) : null
  }

  async create(projectId: string, raw: unknown, createdBy: string | null): Promise<TaskRow> {
    const input = CreateTask.parse(raw)
    return this.db.transaction(async (tx) => {
      await tx.execute(boardLock(projectId, input.status))
      const [row] = await tx
        .insert(tasks)
        .values({
          projectId: Number(projectId),
          repositoryId: id(input.repositoryId),
          environmentId: id(input.environmentId),
          service: input.service,
          parentId: id(input.parentId),
          title: input.title,
          description: input.description,
          status: input.status,
          priority: input.priority,
          type: input.type,
          labels: input.labels,
          assignee: input.assignee,
          agent: input.agent,
          createdBy,
          // Append: one gap past the last card in the column it lands in.
          position: sql`coalesce((select max(position) + 1024 from tasks where project_id = ${Number(projectId)} and status = ${input.status}), 1024)`,
          dueAt: input.dueAt,
          sourceKey: input.sourceKey,
          draft: input.draft,
          closedAt: input.status === 'done' ? new Date() : null,
        })
        .returning()
      return toTask(row!)
    })
  }

  async update(taskId: string, raw: unknown): Promise<TaskRow | null> {
    const patch = UpdateTask.parse(raw)
    if (!/^\d+$/.test(taskId)) return null
    const changes: Record<string, unknown> = { updatedAt: sql`now()` }
    if (patch.title !== undefined) changes['title'] = patch.title
    if (Object.hasOwn(patch, 'description')) changes['description'] = patch.description ?? null
    if (patch.status !== undefined) changes['status'] = patch.status
    if (Object.hasOwn(patch, 'priority')) changes['priority'] = patch.priority ?? null
    if (Object.hasOwn(patch, 'type')) changes['type'] = patch.type ?? null
    if (patch.labels !== undefined) changes['labels'] = patch.labels
    if (Object.hasOwn(patch, 'assignee')) changes['assignee'] = patch.assignee ?? null
    if (Object.hasOwn(patch, 'agent')) changes['agent'] = patch.agent ?? null
    if (Object.hasOwn(patch, 'parentId')) changes['parentId'] = id(patch.parentId)
    if (Object.hasOwn(patch, 'repositoryId')) changes['repositoryId'] = id(patch.repositoryId)
    if (Object.hasOwn(patch, 'environmentId')) changes['environmentId'] = id(patch.environmentId)
    if (Object.hasOwn(patch, 'service')) changes['service'] = patch.service ?? null
    if (patch.position !== undefined) changes['position'] = patch.position
    if (Object.hasOwn(patch, 'dueAt')) changes['dueAt'] = patch.dueAt ?? null
    if (Object.hasOwn(patch, 'sourceKey')) changes['sourceKey'] = patch.sourceKey ?? null
    if (patch.draft !== undefined) changes['draft'] = patch.draft
    // Closing stamps once and reopening clears; a change that does not touch
    // the status leaves the stamp alone.
    if (patch.status === 'done') changes['closedAt'] = sql`coalesce(closed_at, now())`
    else if (patch.status !== undefined) changes['closedAt'] = null

    const [row] = await this.db.update(tasks).set(changes).where(eq(tasks.id, Number(taskId))).returning()
    return row ? toTask(row) : null
  }

  /** Move a task and compute its sparse rank in one serialised transaction. */
  async move(
    taskId: string,
    status: TaskStatus,
    beforeId: string | null,
    afterId: string | null,
  ): Promise<TaskRow | null> {
    if (!/^\d+$/.test(taskId)) return null
    const numericId = Number(taskId)
    return this.db.transaction(async (tx) => {
      const [currentRow] = await tx.select().from(tasks).where(eq(tasks.id, numericId)).for('update')
      if (!currentRow) return null
      const current = toTask(currentRow)
      await tx.execute(boardLock(current.projectId, status))

      const neighbour = async (neighbourId: string | null): Promise<TaskRow | null> => {
        if (!neighbourId) return null
        const [row] = await tx.select().from(tasks).where(eq(tasks.id, Number(neighbourId))).for('update')
        const found = row ? toTask(row) : null
        if (!found || found.projectId !== current.projectId || found.status !== status || found.id === taskId) {
          throw new Error(`invalid move neighbour '${neighbourId}'`)
        }
        return found
      }

      const appendRank = async (): Promise<number> => {
        const [row] = await tx
          .select({ rank: sql<string>`coalesce(max(${tasks.position}), 0)::text` })
          .from(tasks)
          .where(
            and(
              eq(tasks.projectId, Number(current.projectId)),
              eq(tasks.status, status),
              sql`${tasks.id} <> ${numericId}`,
            ),
          )
        return Number(row?.rank ?? 0) + 1024
      }

      const rankBetween = (before: TaskRow | null, after: TaskRow | null, empty: number): number =>
        before && after
          ? Math.floor((before.position + after.position) / 2)
          : before
            ? before.position + 1024
            : after
              ? Math.max(0, after.position - 1024)
              : empty

      let before = await neighbour(beforeId)
      let after = await neighbour(afterId)
      let position = rankBetween(before, after, await appendRank())

      // The gap closed. Respace the column and try once more; this is rare and
      // bounded, and it beats letting two cards share a rank.
      if ((before && after && position <= before.position) || (after && position >= after.position)) {
        const rows = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.projectId, Number(current.projectId)),
              eq(tasks.status, status),
              sql`${tasks.id} <> ${numericId}`,
            ),
          )
          .orderBy(asc(tasks.position), asc(tasks.id))
          .for('update')
        for (const [index, row] of rows.entries()) {
          await tx.update(tasks).set({ position: (index + 1) * 1024 }).where(eq(tasks.id, row.id))
        }
        before = beforeId ? await neighbour(beforeId) : null
        after = afterId ? await neighbour(afterId) : null
        position = rankBetween(before, after, 1024)
      }

      const [moved] = await tx
        .update(tasks)
        .set({
          status,
          position,
          closedAt: status === 'done' ? sql`coalesce(closed_at, now())` : null,
          updatedAt: sql`now()`,
        })
        .where(eq(tasks.id, numericId))
        .returning()
      return moved ? toTask(moved) : null
    })
  }

  async remove(taskId: string): Promise<boolean> {
    if (!/^\d+$/.test(taskId)) return false
    const rows = await this.db.delete(tasks).where(eq(tasks.id, Number(taskId))).returning({ id: tasks.id })
    return rows.length > 0
  }

  async countByProject(): Promise<
    Map<string, { open: number; inProgress: number; blocked: number; review: number; done: number }>
  > {
    const rows = await this.db
      .select({ projectId: tasks.projectId, status: tasks.status, count: count() })
      .from(tasks)
      .where(eq(tasks.draft, false))
      .groupBy(tasks.projectId, tasks.status)

    const map = new Map<string, { open: number; inProgress: number; blocked: number; review: number; done: number }>()
    for (const row of rows) {
      const key = String(row.projectId)
      const entry = map.get(key) ?? { open: 0, inProgress: 0, blocked: 0, review: 0, done: 0 }
      if (row.status === 'done') entry.done += row.count
      else {
        entry.open += row.count
        if (row.status === 'in_progress') entry.inProgress += row.count
        if (row.status === 'blocked') entry.blocked += row.count
        if (row.status === 'review') entry.review += row.count
      }
      map.set(key, entry)
    }
    return map
  }

  async findBySourceKey(projectId: string, sourceKey: string): Promise<TaskRow | null> {
    const [row] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, Number(projectId)), eq(tasks.sourceKey, sourceKey)))
    return row ? toTask(row) : null
  }

  async findIntactDraft(filter: {
    projectId: string
    createdBy: string | null
    parentId: string | null
  }): Promise<TaskRow | null> {
    const matches = await this.list({
      projectId: filter.projectId,
      createdBy: filter.createdBy,
      parentId: filter.parentId,
      draft: true,
      limit: 20,
    })
    return matches.find((row) => isIntactDraft(row)) ?? null
  }

  async sweepIntactDrafts(projectId: string, olderThan: Date): Promise<number> {
    const rows = await this.list({ projectId, draft: true, limit: 200 })
    let removed = 0
    for (const row of rows) {
      if (row.updatedAt < olderThan && isIntactDraft(row)) {
        if (await this.remove(row.id)) removed += 1
      }
    }
    return removed
  }

  // --- notes ---------------------------------------------------------------

  async listNotes(taskId: string): Promise<TaskNoteRow[]> {
    const rows = await this.db
      .select()
      .from(taskNotes)
      .where(eq(taskNotes.taskId, Number(taskId)))
      .orderBy(asc(taskNotes.createdAt), asc(taskNotes.id))
    return rows.map(toNote)
  }

  async findNote(taskId: string, noteId: string): Promise<TaskNoteRow | null> {
    if (!/^\d+$/.test(noteId)) return null
    const [row] = await this.db
      .select()
      .from(taskNotes)
      .where(and(eq(taskNotes.taskId, Number(taskId)), eq(taskNotes.id, Number(noteId))))
    return row ? toNote(row) : null
  }

  async findNoteBySourceKey(taskId: string, sourceKey: string): Promise<TaskNoteRow | null> {
    const [row] = await this.db
      .select()
      .from(taskNotes)
      .where(and(eq(taskNotes.taskId, Number(taskId)), eq(taskNotes.sourceKey, sourceKey)))
    return row ? toNote(row) : null
  }

  async addNote(
    taskId: string,
    body: string,
    actor: string | null,
    actorKind: 'human' | 'agent' | 'system',
    sourceKey: string | null = null,
  ): Promise<TaskNoteRow> {
    const text = z.string().min(1).max(65536).parse(body)
    const [row] = await this.db
      .insert(taskNotes)
      .values({ taskId: Number(taskId), actor, actorKind, body: text, sourceKey })
      .returning()
    await this.touch(taskId)
    return toNote(row!)
  }

  async updateNote(taskId: string, noteId: string, body: string): Promise<TaskNoteRow | null> {
    const text = z.string().min(1).max(65536).parse(body)
    if (!/^\d+$/.test(noteId)) return null
    const [row] = await this.db
      .update(taskNotes)
      .set({ body: text, updatedAt: sql`now()` })
      .where(and(eq(taskNotes.taskId, Number(taskId)), eq(taskNotes.id, Number(noteId))))
      .returning()
    if (row) await this.touch(taskId)
    return row ? toNote(row) : null
  }

  async removeNote(taskId: string, noteId: string): Promise<boolean> {
    if (!/^\d+$/.test(noteId)) return false
    const rows = await this.db
      .delete(taskNotes)
      .where(and(eq(taskNotes.taskId, Number(taskId)), eq(taskNotes.id, Number(noteId))))
      .returning({ id: taskNotes.id })
    return rows.length > 0
  }

  async setNotePublication(
    taskId: string,
    noteId: string,
    detail: {
      state: 'pending' | 'synced' | 'error'
      githubCommentId?: number | null
      githubHtmlUrl?: string | null
      error?: string | null
    },
  ): Promise<TaskNoteRow | null> {
    if (!/^\d+$/.test(noteId)) return null
    const [row] = await this.db
      .update(taskNotes)
      .set({
        publishState: detail.state,
        githubCommentId: detail.githubCommentId ?? null,
        githubHtmlUrl: detail.githubHtmlUrl ?? null,
        publishError: detail.error ?? null,
      })
      .where(and(eq(taskNotes.taskId, Number(taskId)), eq(taskNotes.id, Number(noteId))))
      .returning()
    return row ? toNote(row) : null
  }

  // --- attachments ---------------------------------------------------------

  async listAttachments(taskId: string): Promise<TaskAttachmentRow[]> {
    const rows = await this.db
      .select(ATTACHMENT_COLUMNS)
      .from(taskAttachments)
      .where(eq(taskAttachments.taskId, Number(taskId)))
      .orderBy(desc(taskAttachments.createdAt), desc(taskAttachments.id))
    return rows.map(toAttachment)
  }

  async countAttachments(taskIds: string[]): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map()
    const rows = await this.db
      .select({ taskId: taskAttachments.taskId, count: count() })
      .from(taskAttachments)
      .where(inArray(taskAttachments.taskId, taskIds.map(Number)))
      .groupBy(taskAttachments.taskId)
    return new Map(rows.map((row) => [String(row.taskId), row.count]))
  }

  async findAttachment(taskId: string, attachmentId: string): Promise<TaskAttachmentRow | null> {
    if (!/^\d+$/.test(attachmentId)) return null
    const [row] = await this.db
      .select(ATTACHMENT_COLUMNS)
      .from(taskAttachments)
      .where(and(eq(taskAttachments.taskId, Number(taskId)), eq(taskAttachments.id, Number(attachmentId))))
    return row ? toAttachment(row) : null
  }

  /** The bytes, asked for on their own, only when something is about to serve them. */
  async readAttachment(
    taskId: string,
    attachmentId: string,
  ): Promise<{ row: TaskAttachmentRow; content: Buffer } | null> {
    if (!/^\d+$/.test(attachmentId)) return null
    const [row] = await this.db
      .select({ ...ATTACHMENT_COLUMNS, content: taskAttachments.content })
      .from(taskAttachments)
      .where(and(eq(taskAttachments.taskId, Number(taskId)), eq(taskAttachments.id, Number(attachmentId))))
    if (!row) return null
    const { content, ...meta } = row
    return { row: toAttachment(meta), content: Buffer.from(content) }
  }

  async addAttachment(
    taskId: string,
    file: { filename: string; contentType: string; content: Buffer },
    actor: string | null,
    actorKind: 'human' | 'agent' | 'system',
  ): Promise<TaskAttachmentRow> {
    const [row] = await this.db
      .insert(taskAttachments)
      .values({
        taskId: Number(taskId),
        filename: file.filename,
        contentType: file.contentType,
        sizeBytes: file.content.byteLength,
        content: file.content,
        actor,
        actorKind,
      })
      .returning(ATTACHMENT_COLUMNS)
    await this.touch(taskId)
    return toAttachment(row!)
  }

  async removeAttachment(taskId: string, attachmentId: string): Promise<boolean> {
    if (!/^\d+$/.test(attachmentId)) return false
    const rows = await this.db
      .delete(taskAttachments)
      .where(and(eq(taskAttachments.taskId, Number(taskId)), eq(taskAttachments.id, Number(attachmentId))))
      .returning({ id: taskAttachments.id })
    if (rows.length > 0) await this.touch(taskId)
    return rows.length > 0
  }

  // --- GitHub binding ------------------------------------------------------

  async findLink(taskId: string): Promise<TaskGitHubLinkRow | null> {
    if (!/^\d+$/.test(taskId)) return null
    const [row] = await this.db.select().from(taskGithubLinks).where(eq(taskGithubLinks.taskId, Number(taskId)))
    return row ? toLink(row) : null
  }

  async listLinks(taskIds?: string[]): Promise<TaskGitHubLinkRow[]> {
    const rows = await this.db
      .select()
      .from(taskGithubLinks)
      .where(taskIds ? inArray(taskGithubLinks.taskId, taskIds.map(Number)) : undefined)
    return rows.map(toLink)
  }

  async upsertLink(link: {
    taskId: string
    githubIssueId: string
    syncState: TaskSyncState
    lastSyncedAt?: Date | null
    lastError?: string | null
    localUpdatedAt?: Date
    remoteUpdatedAt?: Date | null
  }): Promise<void> {
    z.enum(TASK_SYNC_STATES).parse(link.syncState)
    await this.db
      .insert(taskGithubLinks)
      .values({
        taskId: Number(link.taskId),
        githubIssueId: Number(link.githubIssueId),
        syncState: link.syncState,
        lastSyncedAt: link.lastSyncedAt ?? null,
        lastError: link.lastError ?? null,
        localUpdatedAt: link.localUpdatedAt ?? new Date(),
        remoteUpdatedAt: link.remoteUpdatedAt ?? null,
      })
      .onConflictDoUpdate({
        target: taskGithubLinks.taskId,
        set: {
          githubIssueId: sql`excluded.github_issue_id`,
          syncState: sql`excluded.sync_state`,
          lastSyncedAt: sql`excluded.last_synced_at`,
          lastError: sql`excluded.last_error`,
          localUpdatedAt: sql`excluded.local_updated_at`,
          remoteUpdatedAt: sql`excluded.remote_updated_at`,
        },
      })
  }

  async setLinkState(
    taskId: string,
    state: TaskSyncState,
    detail: {
      lastError?: string | null
      lastSyncedAt?: Date | null
      remoteUpdatedAt?: Date | null
      localUpdatedAt?: Date
    } = {},
  ): Promise<void> {
    await this.db
      .update(taskGithubLinks)
      .set({
        syncState: state,
        lastError: detail.lastError ?? null,
        // COALESCE, so "no news" keeps the last known timestamp rather than
        // erasing evidence of the last successful sync.
        lastSyncedAt: sql`coalesce(${detail.lastSyncedAt ?? null}, ${taskGithubLinks.lastSyncedAt})`,
        remoteUpdatedAt: sql`coalesce(${detail.remoteUpdatedAt ?? null}, ${taskGithubLinks.remoteUpdatedAt})`,
        localUpdatedAt: sql`coalesce(${detail.localUpdatedAt ?? null}, ${taskGithubLinks.localUpdatedAt})`,
      })
      .where(eq(taskGithubLinks.taskId, Number(taskId)))
  }

  async removeLink(taskId: string): Promise<boolean> {
    if (!/^\d+$/.test(taskId)) return false
    const rows = await this.db
      .delete(taskGithubLinks)
      .where(eq(taskGithubLinks.taskId, Number(taskId)))
      .returning({ taskId: taskGithubLinks.taskId })
    return rows.length > 0
  }

  // --- environments --------------------------------------------------------

  async listEnvironments(taskIds?: string[]): Promise<TaskEnvironmentRow[]> {
    const rows = await this.db
      .select({
        taskId: taskEnvironments.taskId,
        environmentId: taskEnvironments.environmentId,
        composeProject: environments.composeProject,
        source: taskEnvironments.source,
        branch: taskEnvironments.branch,
        linkedAt: taskEnvironments.linkedAt,
      })
      .from(taskEnvironments)
      .innerJoin(environments, eq(environments.id, taskEnvironments.environmentId))
      .where(taskIds ? inArray(taskEnvironments.taskId, taskIds.map(Number)) : undefined)
      .orderBy(asc(taskEnvironments.linkedAt))
    return rows.map((row) => ({
      ...row,
      taskId: String(row.taskId),
      environmentId: String(row.environmentId),
    }))
  }

  /** Replace the manual links of one task. Inferred links are never stored. */
  async setEnvironments(taskId: string, composeProjects: string[]): Promise<void> {
    const names = z.array(z.string().min(1).max(255)).max(64).parse(composeProjects)
    const numericId = Number(taskId)
    await this.db.transaction(async (tx) => {
      await tx
        .delete(taskEnvironments)
        .where(and(eq(taskEnvironments.taskId, numericId), eq(taskEnvironments.source, 'manual')))
      if (names.length === 0) return
      const known = await tx
        .select({ id: environments.id })
        .from(environments)
        .where(inArray(environments.composeProject, names))
      for (const environment of known) {
        await tx
          .insert(taskEnvironments)
          .values({ taskId: numericId, environmentId: environment.id, source: 'manual' })
          .onConflictDoUpdate({
            target: taskEnvironments.environmentId,
            set: { taskId: numericId, source: 'manual', linkedAt: sql`now()` },
          })
      }
    })
  }

  /** A note or an attachment changed what the task shows, so the task changed. */
  private async touch(taskId: string): Promise<void> {
    await this.db.update(tasks).set({ updatedAt: sql`now()` }).where(eq(tasks.id, Number(taskId)))
  }
}
