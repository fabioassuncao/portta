import type { Db } from './client.ts'
import { instance } from './schema/instance.ts'

/**
 * The minimum a fresh database needs to be a Portta: an identity row.
 *
 * Nothing else. Demonstration content comes from the example document the API
 * applies (`--demo`), not from SQL, so what a new operator sees is produced by
 * the same code path their own first task will take.
 */
export async function seedMinimal(db: Db, name = 'portta'): Promise<void> {
  await db.insert(instance).values({ name }).onConflictDoNothing({ target: instance.singleton })
}
