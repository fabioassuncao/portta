import { isTrue } from './config.ts'

// The verdicts `portta doctor` reaches, separated from the probes that gather
// their inputs.
//
// Everything here is a pure function of facts. That is what makes a diagnostic
// testable: "a 172.x address published on 0.0.0.0 is a finding" can be asserted
// without a Docker daemon, a tailnet or a certificate on disk. The probes live
// in `packages/cli/src/doctor.ts` and produce nothing but these inputs.
//
// `doctor` is read-only by construction. Nothing in this module or its callers
// applies a fix, stops a container or removes anything: a check reports, and
// names the command a person may choose to run.

export type CheckStatus = 'pass' | 'warn' | 'fail'

/**
 * The shape `scripts/doctor.sh --json` emits and every consumer already reads.
 * Keeping it identical is what let the port happen without touching a caller.
 */
export interface DoctorCheck {
  id: string
  status: CheckStatus
  title: string
  detail: string
  fix: string
}

export function check(id: string, status: CheckStatus, title: string, detail: string, fix = ''): DoctorCheck {
  return { id, status, title, detail, fix }
}

export interface DoctorSummary {
  failures: number
  warnings: number
  ok: boolean
}

export function summarise(checks: DoctorCheck[]): DoctorSummary {
  const failures = checks.filter((entry) => entry.status === 'fail').length
  const warnings = checks.filter((entry) => entry.status === 'warn').length
  return { failures, warnings, ok: failures === 0 }
}

/** The leading integer of a version string, or null when there is none. */
export function versionMajor(value: string): number | null {
  const match = /^v?(\d+)/.exec(value.trim())
  return match ? Number(match[1]) : null
}

export function meetsMinimum(value: string, minimum: number): boolean {
  const major = versionMajor(value)
  return major !== null && major >= minimum
}

/**
 * `.env` holds every credential the gateway has. Group- or world-readable is a
 * finding, not a preference — but a warning, because the file still works and
 * the operator may be the only user on the host.
 */
export function envPermissionVerdict(mode: string | null): DoctorCheck {
  if (!mode) return check('config.env.perms', 'warn', '.env permissions', 'could not be read')
  const numeric = Number.parseInt(mode, 8)
  const others = numeric & 0o077
  return others === 0
    ? check('config.env.perms', 'pass', '.env permissions', mode)
    : check('config.env.perms', 'warn', '.env permissions', `${mode} is group/world readable`, 'chmod 600 .env')
}

/**
 * A floating tag makes the gateway a different program after any `docker pull`.
 * See docs/adr/0004-pinned-versions.md.
 */
export function imageTagVerdict(image: string): DoctorCheck {
  const fix = 'pin a version in docker/compose/compose.yaml; see docs/adr/0004-pinned-versions.md'
  if (image.endsWith(':latest')) return check('traefik.image', 'warn', 'traefik image', `${image} uses the floating 'latest' tag`, fix)
  // A tag, not a registry port: `ghcr.io:443/x` has a colon and no tag.
  const tagged = /:[^/:]+$/.test(image)
  if (!tagged) return check('traefik.image', 'warn', 'traefik image', `${image} has no tag, which implies :latest`, fix)
  return check('traefik.image', 'pass', 'traefik image', image)
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', 'localhost', '::1'])

export function isLoopbackAddress(address: string): boolean {
  return LOOPBACK_ADDRESSES.has(address)
}

export function isWildcardAddress(address: string): boolean {
  return address === '0.0.0.0' || address === '::'
}

/**
 * Ports a gateway-owned container must never publish on every interface.
 * A database or the Docker API reachable from the network is the failure this
 * whole design exists to prevent.
 */
export const SENSITIVE_PORTS = ['5432/tcp', '3306/tcp', '6379/tcp', '27017/tcp', '2375/tcp', '2376/tcp']

export function publishesSensitivePort(published: string): boolean {
  return SENSITIVE_PORTS.some((port) => published.includes(`0.0.0.0:`) && published.includes(`->${port}`))
}

/**
 * The traffic Traefik answers, judged for the profile.
 *
 * The panel's own entrypoint (container port 8090) is public on purpose in
 * `public` access mode, and is the one port that is authenticated. Judging the
 * application entrypoints without it is what stops a correctly configured
 * public panel reading as a finding. See docs/adr/0021-panel-access-modes.md.
 */
export function applicationBinds(binds: string, panelIsPublic: boolean): string {
  if (!panelIsPublic) return binds
  return binds.split(' ').filter((entry) => entry && !entry.startsWith('8090/tcp=')).join(' ')
}

export function exposureVerdict(profile: string, binds: string, panelIsPublic: boolean): DoctorCheck | null {
  const application = applicationBinds(binds, panelIsPublic)
  const publiclyBound = /0\.0\.0\.0:|::/.test(application)
  if (profile === 'local') {
    if (publiclyBound) {
      return check('exposure.local', 'fail', 'local profile exposure',
        'an application entrypoint is bound to a non-loopback address in the local profile',
        "set PORTTA_BIND_ADDRESS=127.0.0.1 and run 'portta up local'")
    }
    return check('exposure.local', 'pass', 'local profile exposure', panelIsPublic
      ? 'applications on loopback; only the authenticated panel entrypoint is public'
      : 'loopback only')
  }
  if (profile === 'remote-private') {
    return binds.includes('0.0.0.0:')
      ? check('exposure.private', 'fail', 'private profile exposure',
          'ports are published on every interface while the profile is private',
          'bind to the VPN address or run Traefik behind the Tailscale sidecar')
      : check('exposure.private', 'pass', 'private profile exposure', 'not publicly bound')
  }
  if (profile === 'remote-public') {
    return check('exposure.public', 'warn', 'public profile', '80/443 are intentionally public',
      'only services that opted in are routed; databases are never published')
  }
  return null
}

/**
 * Where the Traefik dashboard listens.
 *
 * It exposes the routing internals of every project on the host, so anything
 * but loopback is a failure rather than a warning.
 */
/**
 * Why a host must not route the dashboard on the domain, or null when it may.
 * Mirrors the panel's own `domain` refusals: a credential and a real domain.
 */
export function dashboardExposeRefusal(env: Record<string, string | undefined>): string | null {
  if ((env['PORTTA_DASHBOARD_EXPOSE'] ?? 'local') !== 'domain') return null
  if (!isTrue(env['PORTTA_DASHBOARD'])) return null
  // Its only protection was the panel's BasicAuth, and the panel signs people
  // in itself now. The dashboard has no credential of its own, it exposes the
  // routing of every project on the host, and an unprotected one is refused
  // rather than warned about.
  // See docs/adr/0035-authentication-lives-in-the-panel.md.
  return 'the Traefik dashboard can no longer be routed on a domain: it has no credential of its own'
}

export function dashboardVerdict(enabled: boolean, bindAddress: string, port: string): DoctorCheck {
  if (!enabled) return check('dashboard', 'pass', 'traefik dashboard', 'disabled')
  return isLoopbackAddress(bindAddress)
    ? check('dashboard', 'pass', 'traefik dashboard', `enabled on ${bindAddress}:${port} (loopback)`)
    : check('dashboard', 'fail', 'traefik dashboard',
        `enabled and bound to ${bindAddress}, which exposes routing internals`,
        'set PORTTA_DASHBOARD_BIND_ADDRESS=127.0.0.1 or PORTTA_DASHBOARD=false')
}

export interface PanelFacts {
  expose: string
  bindAddress: string
  port: string
  /** `disabled` or `required`, as `.env` spells it. */
  authMode: string
  /** Whether PORTTA_AUTH_SECRET is set. Never the value. */
  secretPresent: boolean
  /** A `.env` or a Traefik file still carrying the credential that used to guard the panel. */
  legacyPanelAuth: boolean
  readOnly: boolean
}

const LOOPBACK_ONLY = new Set(['local'])

/**
 * What stands in front of the panel.
 *
 * The answer used to be Traefik: a BasicAuth hash, then a ForwardAuth
 * middleware. It is now the panel itself, so what this checks is that the two
 * decisions agree — a panel reachable from another machine must be in
 * `required` mode, and a panel in `required` mode must have a secret to sign
 * sessions with.
 *
 * It fails rather than warns, for the same reason it always did: a reachable
 * panel can start, stop and remove every container on the host. The panel's own
 * process refuses to start in the wrong combination, so a failure here is a
 * host that will not come up, not a host that is quietly open.
 */
export function panelAuthVerdicts(panel: PanelFacts): DoctorCheck[] {
  const checks: DoctorCheck[] = []
  const required = panel.authMode === 'required'
  const reachable = !LOOPBACK_ONLY.has(panel.expose) || !isLoopbackAddress(panel.bindAddress)

  if (!reachable) {
    checks.push(check('web.auth', 'pass', 'panel authentication',
      required
        ? `signs people in; loopback only on ${panel.bindAddress}:${panel.port}`
        : `local operator; loopback only on ${panel.bindAddress}:${panel.port}`))
  } else if (!required) {
    checks.push(check('web.auth', 'fail', 'panel authentication',
      `the panel is reachable beyond this host (access: ${panel.expose}, bind: ${panel.bindAddress}) and asks nobody who they are`,
      'portta config set panel.auth required   then portta web up'))
  } else {
    checks.push(check('web.auth', 'pass', 'panel authentication',
      `signs people in (access: ${panel.expose})`))
  }

  if (required) {
    checks.push(panel.secretPresent
      ? check('web.auth.secret', 'pass', 'panel session secret', 'set')
      : check('web.auth.secret', 'fail', 'panel session secret',
          'PORTTA_AUTH_MODE=required with no PORTTA_AUTH_SECRET: the panel refuses to start',
          'portta web up   (generates it without printing it)'))
  }

  // An upgraded host can still carry the credential that used to guard the
  // panel. Nothing reads it any more, and leaving it in place suggests a door
  // that is still there.
  if (panel.legacyPanelAuth) {
    checks.push(check('web.auth.legacy', 'warn', 'panel authentication leftovers',
      'this host still carries the Traefik credential the panel used before it signed people in',
      'portta web up   rewrites the generated files and the keys are safe to delete from .env'))
  }

  if (reachable && !panel.readOnly) {
    checks.push(check('web.readonly', 'warn', 'panel write access',
      'reachable and writable: whoever signs in can stop containers',
      'portta web up --read-only'))
  }
  return checks
}

/**
 * Whether a gateway component is unstarted or broken.
 *
 * `portta bootstrap` ends by running doctor, on a host where nothing has been
 * started yet. Treating "does not exist" as a failure made bootstrap exit 1 on
 * every fresh host, and every CI job that boots the gateway died before `up`.
 * A component that does not exist yet is a **warning**; a component in a bad
 * state stays a failure.
 */
export function componentVerdict(
  id: string,
  title: string,
  present: boolean,
  state: string | null,
  health: string | null,
  fix: string,
): DoctorCheck {
  if (!present) return check(id, 'warn', title, 'container not created', fix)
  if (state !== 'running' || health === 'unhealthy') return check(id, 'fail', title, `${state} (${health ?? 'none'})`, fix)
  if (health === 'starting') return check(id, 'warn', title, 'health check is still starting', fix)
  return check(id, 'pass', title, `${state} (${health ?? 'none'})`)
}

/**
 * The store holding every protected host's credential.
 *
 * Same rule as `componentVerdict`: absent *and* nothing running is a gateway
 * that has not started yet. Absent while the service runs is broken.
 */
export function authStoreVerdict(present: boolean, mode: string | null, serviceExists: boolean): DoctorCheck {
  if (!present && !serviceExists) {
    return check('auth.store', 'warn', 'authentication store', 'not created yet', 'portta up   (creates and migrates it)')
  }
  if (!present) {
    return check('auth.store', 'fail', 'authentication store', 'missing while the service is running', 'portta up   (creates and migrates it)')
  }
  return mode === '600'
    ? check('auth.store', 'pass', 'authentication store', 'present at mode 600')
    : check('auth.store', 'fail', 'authentication store', `mode ${mode ?? 'unknown'}; credentials must be owner-only`,
        'chmod 600 state/auth/protections.json')
}

/**
 * The host path of the GitHub App's private key, or null when the configured
 * value names a file the panel cannot open.
 *
 * `./state/github` is the only directory mounted into the panel, so the
 * container path is the host path with that prefix swapped. Passing here on a
 * file the panel never reads is worse than having no check: it certifies the
 * wrong thing.
 */
export function githubKeyHostPath(configured: string, root: string): string | null {
  const prefix = '/app/state/github/'
  if (configured.split('/').includes('..')) return null
  if (!configured.startsWith(prefix) || configured === prefix) return null
  return `${root}/state/github/${configured.slice(prefix.length)}`
}

/** Modes that keep a private key to its owner. */
export function keyModeIsPrivate(mode: string | null): boolean {
  return mode === '600' || mode === '400'
}

/**
 * Two Compose projects whose names differ only in punctuation collapse to the
 * same hostname once normalised. That silently steals traffic.
 */
export function duplicates(values: string[]): string[] {
  const seen = new Map<string, number>()
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1)
  return [...seen.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort()
}

/** Images that are almost always a mistake on the shared HTTP network. */
const DATASTORE_IMAGE = /postgres|mysql|mariadb|redis|mongo|memcached/i

export function looksLikeDatastore(image: string): boolean {
  return DATASTORE_IMAGE.test(image)
}

/**
 * Compose interpolates `${VAR}` inside a label written in list form but not
 * inside a mapping key. A project that used the map form ships labels with a
 * literal `${...}`, and every worktree of it then collapses onto one Traefik
 * service. Cheap to detect, very confusing to debug.
 */
export function hasUninterpolatedLabel(labels: Record<string, string>): boolean {
  return Object.entries(labels).some(([key, value]) => key.startsWith('traefik.') && (key.includes('${') || value.includes('${')))
}

/** The Traefik service names a container declares. One flat namespace per host. */
export function traefikServiceNames(labels: Record<string, string>): string[] {
  const names = new Set<string>()
  for (const key of Object.keys(labels)) {
    const match = /^traefik\.http\.services\.([^.]+)\./.exec(key)
    if (match) names.add(match[1]!)
  }
  return [...names]
}
