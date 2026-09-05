// Work sessions: who is working on what, since when, and what came out.

import { z } from 'zod'
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { SESSION_ABANDON_AFTER_SECONDS, type SessionStatus } from 'portta-core'
import { type Db, workSessions } from 'portta-db'

export interface SessionRow {
  id: string
  projectId: string
  taskId: string | null
  repositoryId: string | null
  environmentId: string | null
  actor: string
  actorKind: 'human' | 'agent'
  agent: string | null
  status: SessionStatus
  startedAt: Date
  lastActivityAt: Date
  endedAt: Date | null
  summary: string | null
  headBefore: string | null
  headAfter: string | null
  commits: Array<{ sha: string; subject: string; at: number }>
}

const Actor = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/)

export const StartSession = z.object({
  actor: Actor.optional(),
  actorKind: z.enum(['human', 'agent']).optional(),
  agent: z.string().max(64).nullable().default(null),
  taskId: z.string().min(1).max(64).nullable().default(null),
  repositoryId: z.string().min(1).max(64).nullable().default(null),
  environmentId: z.string().min(1).max(64).nullable().default(null),
  summary: z.string().max(2000).nullable().default(null),
  headBefore: z.string().max(64).nullable().default(null),
}).strict()

export const UpdateSession = z.object({
  status: z.enum(['active', 'ended', 'abandoned']).optional(),
  summary: z.string().max(2000).nullable().optional(),
  headAfter: z.string().max(64).nullable().optional(),
  taskId: z.string().min(1).max(64).nullable().optional(),
  environmentId: z.string().min(1).max(64).nullable().optional(),
  repositoryId: z.string().min(1).max(64).nullable().optional(),
  heartbeat: z.boolean().optional(),
}).strict()

type Row = typeof workSessions.$inferSelect

const id = (value: string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value)

function toRow(row: Row): SessionRow {
  return {
    ...row,
    id: String(row.id),
    projectId: String(row.projectId),
    taskId: row.taskId === null ? null : String(row.taskId),
    repositoryId: row.repositoryId === null ? null : String(row.repositoryId),
    environmentId: row.environmentId === null ? null : String(row.environmentId),
  }
}

export class WorkSessionsRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async list(
    filter: { projectId?: string; taskId?: string; status?: SessionStatus[]; limit?: number } = {},
  ): Promise<SessionRow[]> {
    const where = [
      filter.projectId ? eq(workSessions.projectId, Number(filter.projectId)) : undefined,
      filter.taskId ? eq(workSessions.taskId, Number(filter.taskId)) : undefined,
      filter.status && filter.status.length > 0 ? inArray(workSessions.status, filter.status) : undefined,
    ].filter((clause) => clause !== undefined)

    const rows = await this.db
      .select()
      .from(workSessions)
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(desc(workSessions.lastActivityAt), desc(workSessions.id))
      .limit(Math.min(Math.max(filter.limit ?? 100, 1), 1000))
    return rows.map(toRow)
  }

  async find(sessionId: string): Promise<SessionRow | null> {
    if (!/^\d+$/.test(sessionId)) return null
    const [row] = await this.db.select().from(workSessions).where(eq(workSessions.id, Number(sessionId)))
    return row ? toRow(row) : null
  }

  async start(projectId: string, raw: unknown, actor: string, actorKind: 'human' | 'agent'): Promise<SessionRow> {
    const input = StartSession.parse(raw)
    const [row] = await this.db
      .insert(workSessions)
      .values({
        projectId: Number(projectId),
        taskId: id(input.taskId),
        repositoryId: id(input.repositoryId),
        environmentId: id(input.environmentId),
        actor: input.actor ?? actor,
        actorKind: input.actorKind ?? actorKind,
        agent: input.agent,
        summary: input.summary,
        headBefore: input.headBefore,
      })
      .returning()
    return toRow(row!)
  }

  async update(sessionId: string, raw: unknown): Promise<SessionRow | null> {
    const patch = UpdateSession.parse(raw)
    const current = await this.find(sessionId)
    if (!current) return null
    const status = patch.status ?? current.status
    const ending = status !== 'active' && current.status === 'active'
    const [row] = await this.db
      .update(workSessions)
      .set({
        status,
        summary: patch.summary !== undefined ? patch.summary : current.summary,
        headAfter: patch.headAfter !== undefined ? patch.headAfter : current.headAfter,
        taskId: patch.taskId !== undefined ? id(patch.taskId) : id(current.taskId),
        environmentId: patch.environmentId !== undefined ? id(patch.environmentId) : id(current.environmentId),
        repositoryId: patch.repositoryId !== undefined ? id(patch.repositoryId) : id(current.repositoryId),
        lastActivityAt: sql`now()`,
        // Reopening a session clears the end; ending one stamps it once.
        endedAt: ending ? sql`now()` : status === 'active' ? null : current.endedAt,
      })
      .where(eq(workSessions.id, Number(sessionId)))
      .returning()
    return row ? toRow(row) : null
  }

  /** Record what a session produced, as the scan sees it. */
  async recordCommits(
    sessionId: string,
    headAfter: string,
    commits: Array<{ sha: string; subject: string; at: number }>,
  ): Promise<void> {
    await this.db
      .update(workSessions)
      .set({ headAfter, commits, lastActivityAt: sql`now()` })
      .where(eq(workSessions.id, Number(sessionId)))
  }

  /** Active sessions nobody touched for too long are abandoned, not active. */
  async abandonStale(now = new Date()): Promise<SessionRow[]> {
    const cutoff = new Date(now.getTime() - SESSION_ABANDON_AFTER_SECONDS * 1000)
    const rows = await this.db
      .update(workSessions)
      .set({ status: 'abandoned', endedAt: sql`now()` })
      .where(and(eq(workSessions.status, 'active'), lt(workSessions.lastActivityAt, cutoff)))
      .returning()
    return rows.map(toRow)
  }
}
