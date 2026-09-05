// Whether the panel asks who you are.
//
// One decision, made once at boot, from the environment. Everything else in the
// panel reads a `Principal`; nothing else asks what mode it is in. That is the
// rule this file exists to make possible.

export type SecurityMode = 'open' | 'protected'

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export interface SecurityConfig {
  mode: SecurityMode
  /** Read-only mode intersects every principal's permissions with the reads. */
  readOnly: boolean
  panelUrl: URL
  /** Extra origins a browser may send from: a VPN name, a public domain. */
  trustedOrigins: string[]
  /** Required when protected; null when open, where Better Auth is never built. */
  secret: string | null
  bindAddress: string
  /**
   * How many sign-in attempts one address gets in ten minutes.
   *
   * Five by default, which is the number that makes guessing expensive. It is
   * configurable because the window is per address and a whole office behind
   * one NAT is one address — not because anybody should turn it off, and the
   * floor below says so.
   */
  signInAttempts: number
}

function isTrue(value: string | undefined): boolean {
  return value === 'true' || value === '1' || value === 'yes'
}

/**
 * A variable Compose always sets, and often to nothing.
 *
 * Every key in a compose file's `environment` reaches the process, so an unset
 * value arrives as an empty string rather than as absent. `??` does not catch
 * that, and `new URL('')` throws — which is how a panel started with a default
 * `PORTTA_PANEL_URL` crashed on boot instead of falling back to loopback.
 */
function set(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

/** Between 3 and 100. A value outside that, or nonsense, is the default. */
function attempts(raw: string | undefined): number {
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 3 || parsed > 100) return 5
  return parsed
}

function isLoopback(address: string): boolean {
  return address === '127.0.0.1' || address === 'localhost' || address === '::1' || address === '[::1]'
}

/**
 * The mode, and the reasons it may be refused.
 *
 * `disabled` means every request is the local operator. That is safe on
 * loopback, where reaching the panel already means having the machine, and it
 * is an open door anywhere else — so it is refused rather than warned about.
 */
export function resolveSecurityMode(env: NodeJS.ProcessEnv): SecurityConfig {
  const raw = (set(env['PORTTA_AUTH_MODE']) ?? 'disabled').toLowerCase()
  if (raw !== 'disabled' && raw !== 'required') {
    throw new ConfigError(`PORTTA_AUTH_MODE must be disabled or required, got ${raw}`)
  }
  const mode: SecurityMode = raw === 'required' ? 'protected' : 'open'

  const bindAddress = set(env['PORTTA_WEB_BIND_ADDRESS']) ?? '127.0.0.1'
  const exposed = !isLoopback(bindAddress) || (set(env['PORTTA_WEB_EXPOSE']) ?? 'local') !== 'local'
  if (mode === 'open' && exposed) {
    throw new ConfigError(
      'PORTTA_AUTH_MODE=disabled is only allowed on loopback; ' +
        'set PORTTA_AUTH_MODE=required before exposing the panel',
    )
  }
  if (mode === 'protected' && !set(env['PORTTA_AUTH_SECRET'])) {
    throw new ConfigError('PORTTA_AUTH_SECRET is required when PORTTA_AUTH_MODE=required')
  }

  const panelUrl = new URL(
    set(env['PORTTA_PANEL_URL']) ?? `http://127.0.0.1:${set(env['PORTTA_WEB_PORT']) ?? '8081'}`,
  )
  const trustedOrigins = (env['PORTTA_PANEL_TRUSTED_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  return {
    mode,
    readOnly: isTrue(env['PORTTA_RUNTIME_READ_ONLY']),
    panelUrl,
    trustedOrigins,
    secret: set(env['PORTTA_AUTH_SECRET']) ?? null,
    bindAddress,
    signInAttempts: attempts(set(env['PORTTA_AUTH_SIGNIN_ATTEMPTS'])),
  }
}

/**
 * Every origin a browser may send a write from.
 *
 * Explicit, never a wildcard: the panel URL, the two loopback spellings on the
 * same port, and whatever the operator configured.
 */
export function trustedOrigins(security: SecurityConfig): string[] {
  const port = security.panelUrl.port || (security.panelUrl.protocol === 'https:' ? '443' : '80')
  return [
    security.panelUrl.origin,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    ...security.trustedOrigins,
  ]
}

/** HTTPS means the cookie may be `Secure`; plain loopback means it may not. */
export function useSecureCookies(security: SecurityConfig): boolean {
  return security.panelUrl.protocol === 'https:'
}
