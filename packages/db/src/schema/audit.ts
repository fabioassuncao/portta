// What was done, by whom, to what.
//
// This is not a SIEM and not a work log: `activity_events` already records what
// happened in the development flow. This records the sensitive writes — who
// signed in, who changed a role, who destroyed an environment — so an operator
// can answer "who did that" months later.
//
// `metadata` never holds a request body, a password, a hash, a token or an
// environment variable. A test asserts that.

import { bigint, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { principalKindEnum } from './enums.ts'
import { projects } from './projects.ts'
import { users } from './auth.ts'

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** Null once the user is removed. `user_email` keeps the line readable. */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    userEmail: text('user_email'),
    principalKind: principalKindEnum('principal_kind').notNull(),
    actor: text('actor').notNull(),
    /** `user.created`, `token.revoked`, … — the closed list in 03 §9. */
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    resourceName: text('resource_name'),
    projectId: bigint('project_id', { mode: 'number' }).references(() => projects.id, { onDelete: 'set null' }),
    ipAddress: text('ip_address'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index('audit_log_at_idx').on(table.at.desc()),
    index('audit_log_user_at_idx').on(table.userId, table.at.desc()),
    index('audit_log_project_at_idx').on(table.projectId, table.at.desc()),
  ],
)

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
  project: one(projects, { fields: [auditLog.projectId], references: [projects.id] }),
}))
