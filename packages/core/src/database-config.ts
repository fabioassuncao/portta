/** Internal DNS and port belong to the managed Compose service, not to settings. */
export const DATABASE_HOST = 'db'
export const DATABASE_PORT = 5432
export type DatabaseMode = 'managed' | 'external'

export function databaseMode(env: Record<string, string | undefined>): DatabaseMode {
  const mode = env['PORTTA_RUNTIME_DB_MODE'] || 'managed'
  if (mode !== 'managed' && mode !== 'external') throw new Error('PORTTA_RUNTIME_DB_MODE must be managed or external')
  return mode
}

/** The only connection resolver. No derived URL is written back to .env. */
export function resolveDatabase(env: Record<string, string | undefined>): { mode: DatabaseMode; url: string | null } {
  const mode = databaseMode(env)
  const override = env['PORTTA_RUNTIME_DATABASE_URL'] || ''
  if (mode === 'external') {
    if (!override) throw new Error('external database mode requires PORTTA_RUNTIME_DATABASE_URL')
    try {
      const parsed = new URL(override)
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) throw new Error()
    } catch { throw new Error('PORTTA_RUNTIME_DATABASE_URL must be a PostgreSQL URL') }
    return { mode, url: override }
  }
  if (override) throw new Error('PORTTA_RUNTIME_DATABASE_URL requires PORTTA_RUNTIME_DB_MODE=external; clear it for the managed database')
  const password = env['PORTTA_RUNTIME_DB_PASSWORD']
  if (!password) return { mode, url: null }
  const user = env['PORTTA_RUNTIME_DB_USER'] || 'portta'
  const name = env['PORTTA_RUNTIME_DB_NAME'] || 'portta'
  return { mode, url: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${DATABASE_HOST}:${DATABASE_PORT}/${encodeURIComponent(name)}` }
}

/** libpq tools use the same URL, passed as environment rather than argv. */
export function databaseClientEnvironment(url: string): Record<string, string> {
  const parsed = new URL(url)
  const env: Record<string, string> = {
    PGHOST: parsed.hostname.replace(/^\[|\]$/g, ''), PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
  }
  const options: Record<string, string> = {
    sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY',
    connect_timeout: 'PGCONNECT_TIMEOUT', application_name: 'PGAPPNAME', options: 'PGOPTIONS',
    target_session_attrs: 'PGTARGETSESSIONATTRS', channel_binding: 'PGCHANNELBINDING',
  }
  for (const [key, value] of parsed.searchParams) {
    const variable = options[key]
    if (!variable) throw new Error(`unsupported database client URL option: ${key}`)
    env[variable] = value
  }
  return env
}
