// The first user.
//
// A panel in `protected` mode with no owner can do exactly one thing: create
// one. Everything else redirects to `/setup`, and the API answers 503
// `setup_required`, because a panel nobody can sign in to is not a panel that
// should be answering questions about the host.

import { count, eq, sql } from 'drizzle-orm'
import { users, type Db } from 'portta-db'
import type { Auth } from './auth.ts'

/** Fixed and documented, like the migration lock: two setups must not race. */
const SETUP_LOCK = 7_412_005

export interface SetupStatus {
  mode: 'open' | 'protected'
  setupRequired: boolean
  /** Whether any user has a second factor, so the sign-in page knows what to expect. */
  twoFactor: boolean
}

export async function hasOwner(db: Db): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(users).where(eq(users.role, 'owner'))
  return (row?.n ?? 0) > 0
}

export async function setupStatus(db: Db, mode: 'open' | 'protected'): Promise<SetupStatus> {
  if (mode === 'open') return { mode, setupRequired: false, twoFactor: false }
  const [owners] = await db.select({ n: count() }).from(users).where(eq(users.role, 'owner'))
  const [factors] = await db.select({ n: count() }).from(users).where(eq(users.twoFactorEnabled, true))
  return {
    mode,
    setupRequired: (owners?.n ?? 0) === 0,
    twoFactor: (factors?.n ?? 0) > 0,
  }
}

export class SetupClosed extends Error {
  readonly status = 409

  constructor() {
    super('this installation already has an owner')
    this.name = 'SetupClosed'
  }
}

export interface BootstrapInput {
  name: string
  email: string
  password: string
}

/**
 * Create the owner, once.
 *
 * The lock, the check and the insert are one transaction, so two people opening
 * `/setup` at the same moment produce one owner and one clear refusal rather
 * than two owners and a question nobody can answer.
 *
 * Which is why this takes a factory rather than the panel's Better Auth
 * instance: that instance holds its own database handle, and a pool hands it a
 * different connection from the one holding the lock — the sign-up would land
 * outside the transaction it is supposed to be protected by. Binding a
 * short-lived instance to `tx` puts the insert where the lock is.
 */
export async function bootstrapOwner(
  authFor: (db: Db) => Auth,
  db: Db,
  input: BootstrapInput,
  headers: Headers,
): Promise<{ user: { id: string; email: string; name: string } }> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SETUP_LOCK})`)
    if (await hasOwner(scoped)) throw new SetupClosed()

    // Through Better Auth, never a direct insert: the password has to be hashed
    // the way sign-in will hash it, and the `user.create` hook is what marks
    // this first account the owner.
    const created = await authFor(scoped).api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
      headers,
      returnHeaders: true,
    })
    return { user: created.response.user }
  })
}
