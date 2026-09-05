// Persistence: the schema, the migrations and the client. No business rule.
//
// `packages/server` owns every rule; this package owns the shape of the rows
// and how to open a connection to them. That separation is what lets a suite
// run the real migrations against PGlite without starting a panel.

export { createDb, schema, type Db, type DbHandle } from './client.ts'
export {
  appliedMigrations,
  holdsLegacySchema,
  migrateWithLock,
  migrationTags,
  migrationsFolder,
  MIGRATIONS_TABLE,
} from './migrate.ts'
export { seedMinimal } from './seed.ts'
export * from './schema/index.ts'
