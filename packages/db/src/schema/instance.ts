// This installation, and what the operator configured on it.

import { sql } from 'drizzle-orm'
import { boolean, check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * One row, forever. `singleton` is unique and checked true, so a second insert
 * conflicts rather than quietly producing a second identity.
 */
export const instance = pgTable(
  'instance',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    singleton: boolean('singleton').notNull().default(true).unique(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('instance_singleton_check', sql`${table.singleton}`),
    check('instance_name_check', sql`btrim(${table.name}) <> ''`),
  ],
)

/**
 * The operator's settings, as a closed catalogue: the keys and their shapes are
 * declared in packages/server/src/services/settings.ts, and a value that does
 * not match its schema is read as absent rather than trusted.
 */
export const settings = pgTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [check('settings_key_check', sql`btrim(${table.key}) <> ''`)],
)
