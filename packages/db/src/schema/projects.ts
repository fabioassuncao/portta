// The Project — what the operator decided exists — and its repositories.
//
// A Project does not disappear when nothing is running, which is the whole
// point of it being a decision rather than an observation (ADR 0013, ADR 0031).

import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { githubRepositories } from './github.ts'
import { repositoryProviderEnum } from './enums.ts'

export const projects = pgTable(
  'projects',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    archived: boolean('archived').notNull().default(false),
    /**
     * The first-level directory under Projects Home (`storefront`), never an
     * absolute path and never the identity: changing PORTTA_PROJECTS_HOME must
     * not invent new Projects (ADR 0031).
     */
    relativePath: text('relative_path'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('projects_slug_check', sql`btrim(${table.slug}) <> ''`),
    check('projects_name_check', sql`btrim(${table.name}) <> ''`),
    check(
      'projects_relative_path_check',
      sql`${table.relativePath} IS NULL OR (btrim(${table.relativePath}) <> '' AND ${table.relativePath} NOT LIKE '/%' AND ${table.relativePath} NOT LIKE '%..%' AND ${table.relativePath} NOT LIKE '%/%')`,
    ),
    uniqueIndex('projects_relative_path_unique')
      .on(table.relativePath)
      .where(sql`${table.relativePath} IS NOT NULL`),
  ],
)

/**
 * A Project's code. It exists without GitHub: a local clone with no remote is a
 * Repository, and the GitHub projection row is optional metadata on it.
 *
 * What the host scan observed (branch, commits, instruction files) is read from
 * state/git at request time and never stored here.
 */
export const repositories = pgTable(
  'repositories',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Free text with a documented vocabulary, so adding one is not a migration. */
    role: text('role'),
    localPath: text('local_path'),
    relativePath: text('relative_path'),
    remoteUrl: text('remote_url'),
    provider: repositoryProviderEnum('provider').notNull().default('local'),
    githubRepositoryId: bigint('github_repository_id', { mode: 'number' })
      .unique()
      .references(() => githubRepositories.id, { onDelete: 'set null' }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('repositories_project_id_name_key').on(table.projectId, table.name),
    check('repositories_name_check', sql`btrim(${table.name}) <> ''`),
    check(
      'repositories_local_path_check',
      sql`${table.localPath} IS NULL OR (${table.localPath} LIKE '/%' AND ${table.localPath} NOT LIKE '%/../%' AND ${table.localPath} NOT LIKE '%/..')`,
    ),
    check(
      'repositories_relative_path_check',
      sql`${table.relativePath} IS NULL OR (btrim(${table.relativePath}) <> '' AND ${table.relativePath} NOT LIKE '/%' AND ${table.relativePath} NOT LIKE '%..%')`,
    ),
    uniqueIndex('repositories_local_path_unique')
      .on(table.localPath)
      .where(sql`${table.localPath} IS NOT NULL`),
    index('repositories_project_idx').on(table.projectId, table.position),
  ],
)

export const projectsRelations = relations(projects, ({ many }) => ({
  repositories: many(repositories),
}))

export const repositoriesRelations = relations(repositories, ({ one }) => ({
  project: one(projects, { fields: [repositories.projectId], references: [projects.id] }),
  github: one(githubRepositories, {
    fields: [repositories.githubRepositoryId],
    references: [githubRepositories.id],
  }),
}))
