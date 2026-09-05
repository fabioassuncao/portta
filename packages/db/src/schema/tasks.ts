// Task: Portta's own unit of work, and the optional binding to a GitHub issue.
//
// A task exists without GitHub. A GitHub issue is an optional binding on top of
// it: the projection in github_issues stays a cache with an age, and a bound
// task follows it, while an unbound task, or a bound one edited while the App
// is unavailable, is local and marked pending
// (docs/adr/0032-portta-development-model.md).

import { relations, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  actorKindEnum,
  publishStateEnum,
  taskEnvironmentSourceEnum,
  taskPriorityEnum,
  taskStatusEnum,
  taskSyncStateEnum,
} from './enums.ts'
import { environments } from './environments.ts'
import { githubIssues } from './github.ts'
import { projects, repositories } from './projects.ts'
import { users } from './auth.ts'

/**
 * `bytea` carrying a Buffer. Drizzle has no first-class binary column, and the
 * alternative — base64 in a text column — would inflate every attachment by a
 * third and hide the size limit from the database.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

export const tasks = pgTable(
  'tasks',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repositoryId: bigint('repository_id', { mode: 'number' }).references(() => repositories.id, {
      onDelete: 'set null',
    }),
    environmentId: bigint('environment_id', { mode: 'number' }).references(() => environments.id, {
      onDelete: 'set null',
    }),
    service: text('service'),
    parentId: bigint('parent_id', { mode: 'number' }).references((): AnyPgColumn => tasks.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('backlog'),
    priority: taskPriorityEnum('priority'),
    /** Free text with a documented vocabulary; adding one is not a migration. */
    type: text('type'),
    labels: jsonb('labels').$type<string[]>().notNull().default([]),
    assignee: text('assignee'),
    agent: text('agent'),
    createdBy: text('created_by'),
    /**
     * Who created it, when the panel knows. Null for a task the CLI or an
     * import made before anyone signed in; `created_by` keeps the name either
     * way, so removing a user never loses the attribution.
     */
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** A sparse rank on the board: gaps of 1024, so a move is one update. */
    position: bigint('position', { mode: 'number' }).notNull().default(0),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
    /** How an import reconciles without embedding database ids. */
    sourceKey: text('source_key'),
    draft: boolean('draft').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    check('tasks_title_check', sql`btrim(${table.title}) <> ''`),
    check('tasks_parent_check', sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`),
    index('tasks_project_status_idx').on(table.projectId, table.status, table.updatedAt.desc()),
    index('tasks_parent_idx').on(table.parentId).where(sql`${table.parentId} IS NOT NULL`),
    index('tasks_repository_idx').on(table.repositoryId).where(sql`${table.repositoryId} IS NOT NULL`),
    index('tasks_board_order_idx').on(table.projectId, table.status, table.position, table.id),
    uniqueIndex('tasks_source_key_present')
      .on(table.projectId, table.sourceKey)
      .where(sql`${table.sourceKey} IS NOT NULL`),
    index('tasks_draft_reuse')
      .on(table.projectId, table.createdBy, table.parentId)
      .where(sql`${table.draft}`),
  ],
)

export const taskNotes = pgTable(
  'task_notes',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    taskId: bigint('task_id', { mode: 'number' })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    actor: text('actor'),
    actorKind: actorKindEnum('actor_kind').notNull().default('human'),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    sourceKey: text('source_key'),
    githubCommentId: bigint('github_comment_id', { mode: 'number' }),
    githubHtmlUrl: text('github_html_url'),
    /** Local until somebody publishes it to the issue the task is bound to. */
    publishState: publishStateEnum('publish_state').notNull().default('local'),
    publishError: text('publish_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    check('task_notes_body_check', sql`btrim(${table.body}) <> ''`),
    index('task_notes_task_idx').on(table.taskId, table.createdAt),
    uniqueIndex('task_notes_source_key_present')
      .on(table.taskId, table.sourceKey)
      .where(sql`${table.sourceKey} IS NOT NULL`),
  ],
)

/**
 * Files attached to a task: a screenshot of the bug, the log that proves it.
 *
 * The bytes live in this table rather than on disk. Every filesystem path the
 * panel touches is a channel shared with the host; an attachment is none of
 * those — it belongs to a task, it is only read back through the API, and it
 * must disappear when the task does. ADR 0013 puts durable decisions in
 * PostgreSQL. The size limit is enforced in the panel and repeated here,
 * because a limit that only exists in one process is not a limit.
 */
export const taskAttachments = pgTable(
  'task_attachments',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    taskId: bigint('task_id', { mode: 'number' })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    content: bytea('content').notNull(),
    actor: text('actor'),
    actorKind: actorKindEnum('actor_kind').notNull().default('human'),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'task_attachments_filename_check',
      sql`btrim(${table.filename}) <> '' AND length(${table.filename}) <= 255`,
    ),
    check(
      'task_attachments_content_type_check',
      sql`btrim(${table.contentType}) <> '' AND length(${table.contentType}) <= 128`,
    ),
    check('task_attachments_size_bytes_check', sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 10485760`),
    index('task_attachments_task_idx').on(table.taskId, table.createdAt.desc()),
  ],
)

/**
 * One task, one issue, at most. `local_updated_at` and `remote_updated_at` are
 * what the sync compares to tell "apply the remote" from "conflict".
 */
export const taskGithubLinks = pgTable('task_github_links', {
  taskId: bigint('task_id', { mode: 'number' })
    .primaryKey()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  githubIssueId: bigint('github_issue_id', { mode: 'number' })
    .notNull()
    .unique()
    .references(() => githubIssues.id, { onDelete: 'cascade' }),
  syncState: taskSyncStateEnum('sync_state').notNull().default('synced'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
  lastError: text('last_error'),
  localUpdatedAt: timestamp('local_updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  remoteUpdatedAt: timestamp('remote_updated_at', { withTimezone: true, mode: 'date' }),
})

export const taskEnvironments = pgTable(
  'task_environments',
  {
    taskId: bigint('task_id', { mode: 'number' })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    environmentId: bigint('environment_id', { mode: 'number' })
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    source: taskEnvironmentSourceEnum('source').notNull(),
    branch: text('branch'),
    linkedAt: timestamp('linked_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.environmentId] }),
    // One task many environments; an environment at most one task, so "what is
    // this running for" has one answer.
    uniqueIndex('task_environments_one_task_per_env').on(table.environmentId),
  ],
)

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  repository: one(repositories, { fields: [tasks.repositoryId], references: [repositories.id] }),
  environment: one(environments, { fields: [tasks.environmentId], references: [environments.id] }),
  parent: one(tasks, { fields: [tasks.parentId], references: [tasks.id], relationName: 'subtasks' }),
  children: many(tasks, { relationName: 'subtasks' }),
  createdByUser: one(users, { fields: [tasks.createdByUserId], references: [users.id] }),
  notes: many(taskNotes),
  attachments: many(taskAttachments),
  githubLink: one(taskGithubLinks, { fields: [tasks.id], references: [taskGithubLinks.taskId] }),
  environmentLinks: many(taskEnvironments),
}))

export const taskNotesRelations = relations(taskNotes, ({ one }) => ({
  task: one(tasks, { fields: [taskNotes.taskId], references: [tasks.id] }),
  user: one(users, { fields: [taskNotes.userId], references: [users.id] }),
}))

export const taskAttachmentsRelations = relations(taskAttachments, ({ one }) => ({
  task: one(tasks, { fields: [taskAttachments.taskId], references: [tasks.id] }),
  user: one(users, { fields: [taskAttachments.userId], references: [users.id] }),
}))

export const taskGithubLinksRelations = relations(taskGithubLinks, ({ one }) => ({
  task: one(tasks, { fields: [taskGithubLinks.taskId], references: [tasks.id] }),
  issue: one(githubIssues, { fields: [taskGithubLinks.githubIssueId], references: [githubIssues.id] }),
}))

export const taskEnvironmentsRelations = relations(taskEnvironments, ({ one }) => ({
  task: one(tasks, { fields: [taskEnvironments.taskId], references: [tasks.id] }),
  environment: one(environments, {
    fields: [taskEnvironments.environmentId],
    references: [environments.id],
  }),
}))
