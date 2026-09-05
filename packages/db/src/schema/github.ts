// The GitHub projection.
//
// Nothing here is a credential. An installation token lives for an hour, is
// minted on demand and cached in memory; it is never written to a row, a log
// line or an API response. What is stored is what the panel is allowed to see
// and when it last looked, so every screen can say how old the answer is.
//
// `github_repositories` is also the authorisation boundary: an operation on a
// repository absent from it is refused before a request is made.

import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { issueStateEnum, metadataSourceEnum } from './enums.ts'

export const githubInstallations = pgTable('github_installations', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  installationId: bigint('installation_id', { mode: 'number' }).notNull().unique(),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').notNull(),
  targetId: bigint('target_id', { mode: 'number' }),
  suspended: boolean('suspended').notNull().default(false),
  permissions: jsonb('permissions').$type<Record<string, string>>().notNull().default({}),
  syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [check('github_installations_account_login_check', sql`btrim(${table.accountLogin}) <> ''`)])

export const githubRepositories = pgTable(
  'github_repositories',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    githubId: bigint('github_id', { mode: 'number' }).notNull().unique(),
    nodeId: text('node_id').notNull(),
    installationId: bigint('installation_id', { mode: 'number' })
      .notNull()
      .references(() => githubInstallations.installationId, { onDelete: 'cascade' }),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull().unique(),
    defaultBranch: text('default_branch'),
    private: boolean('private').notNull(),
    htmlUrl: text('html_url').notNull(),
    archived: boolean('archived').notNull().default(false),
    syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('github_repositories_installation_idx').on(table.installationId)],
)

/**
 * Issues, as a projection. GitHub owns the issue; this is a cache with an age.
 * Comments are deliberately not projected: they are large, they change often,
 * and a link to GitHub beats a worse comment reader.
 */
export const githubIssues = pgTable(
  'github_issues',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    githubId: bigint('github_id', { mode: 'number' }).notNull().unique(),
    nodeId: text('node_id').notNull(),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => githubRepositories.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    state: issueStateEnum('state').notNull(),
    stateReason: text('state_reason'),
    issueType: text('issue_type'),
    workflowStatus: text('workflow_status'),
    priority: text('priority'),
    /** Whether status and priority came from fields or from labels. */
    metadataSource: metadataSourceEnum('metadata_source').notNull().default('none'),
    labels: jsonb('labels').$type<string[]>().notNull().default([]),
    assignees: jsonb('assignees').$type<string[]>().notNull().default([]),
    milestone: jsonb('milestone').$type<{ number: number | null; title: string; state: string }>(),
    htmlUrl: text('html_url').notNull(),
    isPullRequest: boolean('is_pull_request').notNull().default(false),
    githubUpdatedAt: timestamp('github_updated_at', { withTimezone: true, mode: 'date' }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('github_issues_repository_id_number_key').on(table.repositoryId, table.number),
    index('github_issues_repo_state_idx').on(table.repositoryId, table.state),
    index('github_issues_updated_idx').on(table.githubUpdatedAt.desc()),
  ],
)

/**
 * Sub-issues, from GitHub's own API. The check refuses the one-step cycle;
 * longer cycles are refused in the code that writes here, because SQL cannot
 * see a path.
 */
export const githubIssueRelationships = pgTable(
  'github_issue_relationships',
  {
    parentId: bigint('parent_id', { mode: 'number' })
      .notNull()
      .references(() => githubIssues.id, { onDelete: 'cascade' }),
    childId: bigint('child_id', { mode: 'number' })
      .notNull()
      .references(() => githubIssues.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('sub_issue'),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.parentId, table.childId] }),
    check('github_issue_relationships_check', sql`${table.parentId} <> ${table.childId}`),
    index('github_issue_relationships_child_idx').on(table.childId),
  ],
)

/**
 * One row per sync scope, so a run can be resumed and a failure is visible
 * rather than silent.
 */
export const githubSyncState = pgTable('github_sync_state', {
  scope: text('scope').primaryKey(),
  cursor: text('cursor'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
  lastError: text('last_error'),
})

export const githubInstallationsRelations = relations(githubInstallations, ({ many }) => ({
  repositories: many(githubRepositories),
}))

export const githubRepositoriesRelations = relations(githubRepositories, ({ one, many }) => ({
  installation: one(githubInstallations, {
    fields: [githubRepositories.installationId],
    references: [githubInstallations.installationId],
  }),
  issues: many(githubIssues),
}))

export const githubIssuesRelations = relations(githubIssues, ({ one }) => ({
  repository: one(githubRepositories, {
    fields: [githubIssues.repositoryId],
    references: [githubRepositories.id],
  }),
}))
