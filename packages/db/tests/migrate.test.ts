// The migration applies, and applying it twice changes nothing.
//
// PGlite is PostgreSQL compiled to WebAssembly, so what runs here is the SQL
// that will run against the real server — enums, checks, partial indexes and
// all — rather than an approximation of it.

import { afterEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { sql } from 'drizzle-orm'
import { createTestDb, type TestDatabase } from '../src/test-db.ts'
import { migrationsFolder, MIGRATIONS_TABLE } from '../src/migrate.ts'
import { instance } from '../src/schema/instance.ts'
import { seedMinimal } from '../src/seed.ts'
import * as schema from '../src/schema/index.ts'

let open: TestDatabase | null = null

afterEach(async () => {
  await open?.close()
  open = null
})

// The pglite driver answers `execute` with a result object; postgres-js answers
// with the rows themselves. Nothing in packages/server depends on the
// difference — it uses the query builder — but a raw statement here does.
async function tableNames(database: TestDatabase): Promise<string[]> {
  const result = await database.db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  )
  return result.rows.map((row) => row.table_name)
}

async function countOf(database: { execute: TestDatabase['db']['execute'] }, statement: ReturnType<typeof sql>): Promise<string | undefined> {
  const result = await database.execute<{ count: string }>(statement)
  return result.rows[0]?.count
}

describe('the initial migration', () => {
  it('creates every table the panel reads', async () => {
    open = await createTestDb()
    const tables = await tableNames(open)
    for (const expected of [
      'accounts', 'activity_events', 'api_keys', 'audit_log', 'environment_settings', 'environments',
      'github_installations', 'github_issue_relationships', 'github_issues', 'github_repositories',
      'github_sync_state', 'instance', 'project_environments', 'project_members', 'projects',
      'repositories', 'service_settings', 'sessions', 'settings', 'task_attachments',
      'task_environments', 'task_github_links', 'task_notes', 'tasks', 'two_factors', 'users',
      'verifications', 'work_sessions',
    ]) {
      expect(tables, expected).toContain(expected)
    }
  })

  // The pre-Drizzle schema is gone, not converted. Its marker table must not
  // reappear: `Database.open` treats one as a volume that needs `portta reset`.
  it('leaves no trace of the schema_migrations the old migrator used', async () => {
    open = await createTestDb()
    expect(await tableNames(open)).not.toContain('schema_migrations')
  })

  it('records itself once in the migrator table', async () => {
    open = await createTestDb()
    expect(await countOf(open.db, sql`SELECT count(*)::text AS count FROM ${sql.identifier(MIGRATIONS_TABLE)}`)).toBe('1')
  })

  it('is idempotent: applying it again applies nothing', async () => {
    const client = new PGlite()
    try {
      const db = drizzle(client, { schema })
      const options = {
        migrationsFolder: migrationsFolder(),
        migrationsTable: MIGRATIONS_TABLE,
        migrationsSchema: 'public',
      }
      await migrate(db, options)
      await migrate(db, options)
      expect(await countOf(db, sql`SELECT count(*)::text AS count FROM ${sql.identifier(MIGRATIONS_TABLE)}`)).toBe('1')
    } finally {
      await client.close()
    }
  })
})

describe('the seed', () => {
  it('creates the one identity row, and only one however often it runs', async () => {
    open = await createTestDb()
    await seedMinimal(open.db as never)
    await seedMinimal(open.db as never)
    const rows = await open.db.select().from(instance)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('portta')
  })
})
