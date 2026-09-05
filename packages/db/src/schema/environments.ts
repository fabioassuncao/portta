// What this host has been observed running, and the overrides on it.
//
// An Environment is identity plus a cache of where it was last seen. It is
// never deleted because a container vanished; only an explicit removal forgets
// it (ADR 0013, ADR 0031).

import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { adoptionSourceEnum } from './enums.ts'
import { projects } from './projects.ts'

export const environments = pgTable(
  'environments',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    composeProject: text('compose_project').notNull().unique(),
    /** Where Compose ran, as the daemon last recorded it. */
    workingDir: text('working_dir'),
    /**
     * Which files Compose read. With these and `working_dir`, an environment
     * whose containers are gone can be started again through the runner with no
     * container to read labels from (ADR 0030). Empty means never observed.
     */
    configFiles: text('config_files').array().notNull().default(sql`'{}'`),
    repoUrl: text('repo_url'),
    repoSubpath: text('repo_subpath'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('environments_compose_project_check', sql`btrim(${table.composeProject}) <> ''`),
    index('environments_last_seen_idx').on(table.lastSeenAt.desc()),
    index('environments_repo_coordinate_idx')
      .on(table.repoUrl, table.repoSubpath)
      .where(sql`${table.repoUrl} IS NOT NULL`),
  ],
)

/**
 * Which Project adopted which Environment, and why. `source` records the reason
 * so the panel can explain an adoption rather than merely present it.
 */
export const projectEnvironments = pgTable(
  'project_environments',
  {
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: bigint('environment_id', { mode: 'number' })
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    source: adoptionSourceEnum('source').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.environmentId] }),
    // An environment belongs to at most one Project: two Projects claiming one
    // running environment would make "which product is this" unanswerable.
    uniqueIndex('project_environments_one_project_per_env').on(table.environmentId),
  ],
)

export const environmentSettings = pgTable(
  'environment_settings',
  {
    environmentId: bigint('environment_id', { mode: 'number' })
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.environmentId, table.key] }),
    check('environment_settings_key_check', sql`btrim(${table.key}) <> ''`),
  ],
)

export const serviceSettings = pgTable(
  'service_settings',
  {
    environmentId: bigint('environment_id', { mode: 'number' })
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    service: text('service').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.environmentId, table.service, table.key] }),
    check('service_settings_service_check', sql`btrim(${table.service}) <> ''`),
    check('service_settings_key_check', sql`btrim(${table.key}) <> ''`),
  ],
)

export const environmentsRelations = relations(environments, ({ many }) => ({
  projectLinks: many(projectEnvironments),
  settings: many(environmentSettings),
  serviceSettings: many(serviceSettings),
}))

export const projectEnvironmentsRelations = relations(projectEnvironments, ({ one }) => ({
  project: one(projects, { fields: [projectEnvironments.projectId], references: [projects.id] }),
  environment: one(environments, {
    fields: [projectEnvironments.environmentId],
    references: [environments.id],
  }),
}))

export const environmentSettingsRelations = relations(environmentSettings, ({ one }) => ({
  environment: one(environments, {
    fields: [environmentSettings.environmentId],
    references: [environments.id],
  }),
}))

export const serviceSettingsRelations = relations(serviceSettings, ({ one }) => ({
  environment: one(environments, {
    fields: [serviceSettings.environmentId],
    references: [environments.id],
  }),
}))
