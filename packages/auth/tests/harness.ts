// A panel's authentication, in memory.
//
// PGlite with the real migrations, and a real Better Auth over it: what these
// suites exercise is the library's own behaviour against Portta's schema, which
// is the only way to find out that a column is missing or a hook never fires.

import { createTestDb } from 'portta-db/testing'
import type { Db } from 'portta-db'
import { createAuth, type Auth } from '../src/auth.ts'
import { hasOwner } from '../src/bootstrap.ts'
import { createPrincipalResolver, type PrincipalResolver } from '../src/principal.ts'
import { resolveSecurityMode, type SecurityConfig } from '../src/security-mode.ts'
import type { Permission } from '../src/access-control.ts'

export interface Harness {
  db: Db
  auth: Auth
  /** Better Auth over any handle, which is how the bootstrap reaches into its transaction. */
  authFor: (db: Db) => Auth
  security: SecurityConfig
  resolver: PrincipalResolver
  close: () => Promise<void>
}

export interface HarnessOptions {
  mode?: 'open' | 'protected'
  readOnly?: boolean
  agentPermissions?: readonly Permission[]
}

export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const { db, close } = await createTestDb()
  const security = resolveSecurityMode(
    options.mode === 'protected'
      ? { PORTTA_AUTH_MODE: 'required', PORTTA_AUTH_SECRET: 'a-test-secret-that-is-long-enough', ...(options.readOnly ? { PORTTA_RUNTIME_READ_ONLY: 'true' } : {}) }
      : options.readOnly
        ? { PORTTA_RUNTIME_READ_ONLY: 'true' }
        : {},
  )

  const handle = db as unknown as Db
  const authFor = (on: Db) => createAuth({ db: on, security, hasOwner: () => hasOwner(on) })
  const auth = authFor(handle)
  const resolver = createPrincipalResolver({
    security,
    db: handle,
    auth: security.mode === 'protected' ? auth : null,
    ...(options.agentPermissions ? { agentPermissions: async () => options.agentPermissions! } : {}),
  })

  return { db: handle, auth, authFor, security, resolver, close }
}

/** Sign in, and hand back the cookie the browser would send next time. */
export async function signIn(auth: Auth, email: string, password: string): Promise<Headers> {
  const response = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
  const cookie = response.headers.get('set-cookie')
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie.split(';')[0] ?? '')
  return headers
}

export function bearer(token: string): Headers {
  return new Headers({ authorization: `Bearer ${token}` })
}
