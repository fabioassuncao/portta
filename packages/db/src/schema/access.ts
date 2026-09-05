// Where a role applies.
//
// The role itself is global (`users.role`); this table says which Projects a
// `developer` or a `viewer` can see. `owner` and `admin` see everything and
// have no rows here — an empty membership list is not a restriction on them.
//
// There is deliberately no per-project role: one role per person keeps "what
// can this person do" answerable without reading a matrix.

import { bigint, index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects.ts'
import { users } from './auth.ts'

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Who granted it. Null once that person is removed; the grant survives. */
    grantedBy: text('granted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index('project_members_user_idx').on(table.userId),
  ],
)

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id], relationName: 'membership' }),
  grantedByUser: one(users, { fields: [projectMembers.grantedBy], references: [users.id], relationName: 'granted' }),
}))
