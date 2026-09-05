// Who is working on what, and what happened.
//
// A work session is a person or an agent working on a task, in a repository, in
// an environment, from a moment to a moment. An activity event is one thing
// that happened in the development flow, with references to the entities it
// concerns. Neither is a log: the process output stays with Docker, and
// activity is pruned — it answers "what happened this week", not audit.

import { relations, sql } from 'drizzle-orm'
import { bigint, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { activitySourceEnum, actorKindEnum, humanOrAgentEnum, sessionStatusEnum } from './enums.ts'
import { environments } from './environments.ts'
import { projects, repositories } from './projects.ts'
import { tasks } from './tasks.ts'
import { users } from './auth.ts'

export const workSessions = pgTable(
  'work_sessions',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: bigint('task_id', { mode: 'number' }).references(() => tasks.id, { onDelete: 'set null' }),
    repositoryId: bigint('repository_id', { mode: 'number' }).references(() => repositories.id, {
      onDelete: 'set null',
    }),
    environmentId: bigint('environment_id', { mode: 'number' }).references(() => environments.id, {
      onDelete: 'set null',
    }),
    actor: text('actor').notNull(),
    actorKind: humanOrAgentEnum('actor_kind').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    agent: text('agent'),
    status: sessionStatusEnum('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    summary: text('summary'),
    headBefore: text('head_before'),
    headAfter: text('head_after'),
    commits: jsonb('commits')
      .$type<Array<{ sha: string; subject: string; at: number }>>()
      .notNull()
      .default([]),
  },
  (table) => [
    check('work_sessions_actor_check', sql`btrim(${table.actor}) <> ''`),
    index('work_sessions_project_status_idx').on(table.projectId, table.status, table.lastActivityAt.desc()),
    index('work_sessions_task_idx').on(table.taskId).where(sql`${table.taskId} IS NOT NULL`),
  ],
)

export const activityEvents = pgTable(
  'activity_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    kind: text('kind').notNull(),
    actor: text('actor'),
    actorKind: actorKindEnum('actor_kind'),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    source: activitySourceEnum('source'),
    projectId: bigint('project_id', { mode: 'number' }).references(() => projects.id, { onDelete: 'cascade' }),
    taskId: bigint('task_id', { mode: 'number' }).references(() => tasks.id, { onDelete: 'set null' }),
    repositoryId: bigint('repository_id', { mode: 'number' }).references(() => repositories.id, {
      onDelete: 'set null',
    }),
    environmentId: bigint('environment_id', { mode: 'number' }).references(() => environments.id, {
      onDelete: 'set null',
    }),
    sessionId: bigint('session_id', { mode: 'number' }).references(() => workSessions.id, {
      onDelete: 'set null',
    }),
    summary: text('summary').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    check('activity_events_kind_check', sql`btrim(${table.kind}) <> ''`),
    index('activity_events_project_at_idx').on(table.projectId, table.at.desc()),
    index('activity_events_at_idx').on(table.at.desc()),
    index('activity_events_task_idx').on(table.taskId, table.at.desc()).where(sql`${table.taskId} IS NOT NULL`),
  ],
)

export const workSessionsRelations = relations(workSessions, ({ one }) => ({
  project: one(projects, { fields: [workSessions.projectId], references: [projects.id] }),
  task: one(tasks, { fields: [workSessions.taskId], references: [tasks.id] }),
  repository: one(repositories, { fields: [workSessions.repositoryId], references: [repositories.id] }),
  environment: one(environments, { fields: [workSessions.environmentId], references: [environments.id] }),
  user: one(users, { fields: [workSessions.userId], references: [users.id] }),
}))

export const activityEventsRelations = relations(activityEvents, ({ one }) => ({
  project: one(projects, { fields: [activityEvents.projectId], references: [projects.id] }),
  task: one(tasks, { fields: [activityEvents.taskId], references: [tasks.id] }),
  session: one(workSessions, { fields: [activityEvents.sessionId], references: [workSessions.id] }),
  user: one(users, { fields: [activityEvents.userId], references: [users.id] }),
}))
