import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres, { type Sql } from 'postgres'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Fixed, and documented because it is: a session-level advisory lock, so the
 * one connection that takes it is the one that runs the migrations and the one
 * that releases them. Any other process picking the same number would serialise
 * against us, which is why it is written down rather than derived.
 */
const LOCK_KEY = 7_412_004

/**
 * Where the generated SQL lives, relative to this module in src/ and in dist/.
 *
 * `import.meta.dirname`, not `new URL('../drizzle', import.meta.url)`. Two
 * reasons, both learnt the hard way: resolving it at module load threw in any
 * test that runs through Vite, where `import.meta.url` is a `/@fs/…` path
 * rather than a file URL; and a bundler reads `new URL(…, import.meta.url)` as
 * an asset reference and tries to resolve `../drizzle` as a module, which it is
 * not — it is a directory of SQL. A plain string is neither.
 */
export function migrationsFolder(): string {
  return join(import.meta.dirname, '..', 'drizzle')
}

/** The table the migrator records applied files in. `drizzle.config.ts` says the same. */
export const MIGRATIONS_TABLE = 'drizzle_migrations'

/**
 * Applies pending migrations on a dedicated single connection, serialised
 * across processes. `max: 1` is what guarantees the lock and the migrations
 * share a connection; the process pool is opened afterwards by `createDb`.
 */
export async function migrateWithLock(url: string, folder: string = migrationsFolder()): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => undefined })
  try {
    await sql`SELECT pg_advisory_lock(${LOCK_KEY})`
    try {
      await migrate(drizzle(sql), {
        migrationsFolder: folder,
        migrationsTable: MIGRATIONS_TABLE,
        migrationsSchema: 'public',
      })
    } finally {
      await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`
    }
  } finally {
    await sql.end({ timeout: 2 })
  }
}

interface Journal {
  entries: Array<{ idx: number; tag: string }>
}

/** The migrations this build carries, in the order they apply. */
export function migrationTags(folder: string = migrationsFolder()): string[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as Journal
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.tag)
}

/**
 * Which of them this database has. The migrator's own table records a hash and
 * a timestamp, not a name, and migrations apply in order — so the count is the
 * prefix of the journal that has been applied.
 */
export async function appliedMigrations(sql: Sql, folder: string = migrationsFolder()): Promise<string[]> {
  const rows = await sql<Array<{ count: string }>>`
    SELECT count(*)::text AS count FROM ${sql(MIGRATIONS_TABLE)}
  `
  const applied = Number(rows[0]?.count ?? 0)
  return migrationTags(folder).slice(0, applied)
}

/**
 * A volume from before the Drizzle reset: the old migrator's bookkeeping table
 * is there and the new one is not. There is no upgrade path — the schema was
 * replaced, not converted — so the panel says so and refuses to start.
 */
export async function holdsLegacySchema(sql: Sql): Promise<boolean> {
  const rows = await sql<Array<{ legacy: boolean }>>`
    SELECT to_regclass('public.schema_migrations') IS NOT NULL
       AND to_regclass('public.' || ${MIGRATIONS_TABLE}) IS NULL AS legacy
  `
  return rows[0]?.legacy === true
}
