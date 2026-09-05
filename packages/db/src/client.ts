import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema/index.ts'

export type Db = PostgresJsDatabase<typeof schema>

export interface DbHandle {
  db: Db
  sql: Sql
}

/**
 * One pool per process. Who owns it is the composer's decision
 * (`apps/web/server`), not this module's: a cache in `globalThis` would hide
 * the lifetime of a connection pool from the code that has to close it.
 */
export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const sql = postgres(url, {
    max: options.max ?? 5,
    connect_timeout: 5,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    // Idempotent DDL emits notices; a panel restart must not be a notice dump.
    onnotice: () => undefined,
  })
  return { db: drizzle(sql, { schema }), sql }
}

export { schema }
