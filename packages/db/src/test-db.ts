// A real PostgreSQL, in memory, with the real migrations.
//
// PGlite is Postgres compiled to WebAssembly, so a suite gets checks, enums,
// cascades, advisory locks and `jsonb` — the things a hand-written fake was
// silently not testing. One instance per test file: they are independent by
// construction and cost about a hundred milliseconds to create.

import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { migrationsFolder, MIGRATIONS_TABLE } from './migrate.ts'
import * as schema from './schema/index.ts'

export type TestDb = PgliteDatabase<typeof schema>

export interface TestDatabase {
  db: TestDb
  close: () => Promise<void>
}

export async function createTestDb(): Promise<TestDatabase> {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, {
    migrationsFolder: migrationsFolder(),
    migrationsTable: MIGRATIONS_TABLE,
    migrationsSchema: 'public',
  })
  return { db, close: () => client.close() }
}
