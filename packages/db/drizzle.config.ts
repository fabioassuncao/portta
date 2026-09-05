import { resolveDatabase } from 'portta-core'
import { defineConfig } from 'drizzle-kit'

// `migrations` repeats what src/migrate.ts declares. The two have to agree:
// drizzle-kit writes the journal that the programmatic migrator reads, and a
// mismatch means the panel re-applies files the CLI already applied.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  migrations: { table: 'drizzle_migrations', schema: 'public' },
  // Schema generation/checking is offline. Connected operations need configuration.
  ...(resolveDatabase(process.env).url ? { dbCredentials: { url: resolveDatabase(process.env).url! } } : {}),
  strict: true,
  verbose: true,
})
