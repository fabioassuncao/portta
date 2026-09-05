import { patchEnvFile, prepareEnvFile } from 'portta-core'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { AUTH_BUILD_FILE, AUTH_DEV_FILE, dashboardExposeRefusal, parseAliases, projectsFor, routesFor, type StoredAlias } from 'portta-core'
import type { Command } from 'commander'
import { composeArguments, gatewayContext } from '../context.js'
import { ensureNetwork, identifier, inspectContainers, networkExists, requireDocker } from '../docker.js'
import { CliError, EXIT, PreconditionError, RefusedError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { CLI_VERSION } from '../version.js'
import { confirm } from '../confirm.js'
import { runDoctor } from '../doctor.js'
import { ensureApplier, removeApplier } from './apply.js'
import { ensureRunner, removeRunner } from './runner.js'
import { refreshRepositories } from './repos.js'
import { ensureMetricsCollector, stopMetricsCollector } from './host.js'
import { finishWebUp, prepareWebUp } from './web.js'
import { requireLocalRelease, selectLocalRelease } from '../local-release.js'
import { applyDemo, demoStacksDown } from './examples.js'

export function checkoutLocalEnv(): Record<string, string> {
  return {
    PORTTA_WEB: 'true',
    PORTTA_WEB_DEV: 'true',
    PORTTA_WEB_BUILD: 'false',
    PORTTA_AUTH_IMAGE: '',
    PORTTA_WEB_IMAGE: '',
  }
}

function persistEnv(root: string, values: Record<string, string>): void {
  const path = join(root, '.env')
  patchEnvFile(path, values)
}

function buildsLocally(command: Command): boolean {
  const files = gatewayContext({ profile: globals(command).profile }).composeFiles
  return files.includes(AUTH_BUILD_FILE) || files.includes(AUTH_DEV_FILE)
}

function globals(command: Command) {
  return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string }
}

async function compose(command: Command, args: string[], stdio: 'inherit' | 'pipe' = 'inherit', extra: { reject?: boolean } = {}) {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  return runProcess('docker', ['compose', ...composeArguments(context), ...args], { cwd: context.root, env: context.env, stdio, reject: extra.reject })
}

export function authMigrationRunArguments(build: boolean, user?: string): string[] {
  return [
    'run', '--rm', '--no-deps',
    ...(build ? ['--build'] : []),
    ...(user ? ['--user', user] : []),
    'portta-auth-migrate',
  ]
}

function ensureAuthState(root: string): void {
  const authDirectory = join(root, 'state/auth')
  mkdirSync(authDirectory, { recursive: true, mode: 0o700 })
  chmodSync(authDirectory, 0o700)
  const path = join(root, '.env')
  prepareEnvFile(path)
}

/**
 * Goes through `compose()` rather than calling `runProcess` itself, which is
 * not a tidying: this ran with the piped default and carries `--build`, so a
 * cold run built the whole panel image with nothing on screen. That was the
 * ten silent minutes of `portta reset`.
 */
async function migrateAuthState(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const user = typeof process.getuid === 'function'
    ? `${process.getuid()}:${process.getgid?.() ?? 0}`
    : undefined
  const build = context.composeFiles.includes(AUTH_BUILD_FILE) || context.composeFiles.includes(AUTH_DEV_FILE)
  await compose(command, authMigrationRunArguments(build, user))
}

/** major.minor, which is the granularity the API contract moves at. */
function series(version: string): string {
  const parts = version.split('.')
  return `${parts[0] ?? '0'}.${parts[1] ?? '0'}`
}

/**
 * The panel's own version, read from the API it serves. Unauthenticated on
 * loopback and over the tailnet; behind Portta ForwardAuth in `public` mode, where a
 * 401 is a perfectly good answer to "is it there" and no answer at all to
 * "which version" — so that case reports the image tag instead, which is what
 * the installation pinned.
 */
async function panelReport(context: ReturnType<typeof gatewayContext>): Promise<{ version: string | null; detail: string }> {
  const image = context.env['PORTTA_WEB_IMAGE'] ?? ''
  const tag = image.includes(':') ? image.slice(image.lastIndexOf(':') + 1) : null
  if (!context.config.webEnabled) return { version: null, detail: 'disabled' }
  const host = context.config.webExpose === 'public' ? '127.0.0.1' : (context.env['PORTTA_WEB_BIND_ADDRESS'] ?? '127.0.0.1')
  try {
    const response = await fetch(`http://${host}:${context.config.webPort}/api/health`, { signal: AbortSignal.timeout(3000) })
    if (response.status === 401) return { version: tag, detail: tag ? `${tag} (from the image tag; the API is behind authentication)` : 'behind authentication' }
    if (!response.ok) return { version: tag, detail: `unreachable (HTTP ${response.status})` }
    const body = await response.json() as { panelVersion?: string }
    return { version: body.panelVersion ?? tag, detail: body.panelVersion ?? 'unknown' }
  } catch {
    return { version: tag, detail: tag ? `${tag} (from the image tag; the panel did not answer)` : 'not running' }
  }
}

export async function versionCommand(command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ required: false })
  const cli = CLI_VERSION
  const gateway = context.version
  // A CLI installed from npm outlives the installation it is pointed at in
  // both directions, so it says which one it is talking to and whether the
  // two agree, rather than failing obscurely three commands later.
  const compatible = series(cli) === series(gateway)

  if (!output.json && !context.composeFiles.length) {
    output.data(`portta ${cli}`)
    return
  }

  const panel = await panelReport(context)
  if (output.json) {
    output.data({
      cli,
      gateway,
      panel: panel.version,
      root: context.root,
      compatible,
      apiSeries: series(gateway),
    })
    return
  }
  output.line(`portta ${cli}`)
  output.line(`  gateway  ${gateway}  (${context.root})`)
  output.line(`  panel    ${panel.detail}`)
  if (!compatible) {
    output.warning(`this CLI is ${cli} and the installation is ${gateway}`)
    output.hint('update the installation by re-running the installer, or install the matching CLI: npm i -g portta@' + gateway)
  }
}

export async function bootstrapCommand(options: { skipPull?: boolean }, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })
  output.step('checkout')
  await requireDocker()
  const composeVersion = await runProcess('docker', ['compose', 'version', '--short'], { reject: false })
  if (composeVersion.exitCode !== 0) throw new CliError('Docker Compose v2 is required', EXIT.precondition)
  prepareEnvFile(join(context.root, '.env'))
  for (const directory of ['state', 'state/auth', 'state/git', 'state/github', 'state/metrics', 'state/logs', 'config/tls', 'config/traefik/dynamic']) mkdirSync(join(context.root, directory), { recursive: true })
  ensureAuthState(context.root)
  const network = await ensureNetwork(context.config.network)
  output.progress(`${network.padEnd(8)} shared network ${context.config.network}`)
  // Explicit build/dev overlays carry checkout-only tags. Ignore those while
  // pulling the remaining pinned images; normal local-release runs select no
  // build overlay and are preflighted by `just up` instead.
  if (!options.skipPull) await compose(command, ['pull', '--ignore-buildable'])
  await doctorCommand(command)
}

export async function upCommand(profile: string | undefined, options: { attach?: boolean; demo?: boolean; localRelease?: boolean }, command: Command): Promise<void> {
  if (profile) command.setOptionValueWithSource('profile', profile, 'cli')
  prepareEnvFile(join(gatewayContext({ profile: profile ?? globals(command).profile }).root, '.env'))
  if (options.localRelease) selectLocalRelease(gatewayContext({ profile: profile ?? globals(command).profile }))
  const context = gatewayContext({ profile: profile ?? globals(command).profile })
  if (options.localRelease) context.env['PORTTA_LOCAL_RELEASE'] = 'true'
  if (context.config.profile === 'remote-public' && context.config.tcpEnabled) throw new RefusedError('TCP entrypoints must not run on the remote-public profile')
  // `vpn` routes the panel on the tailnet hostname; with Traefik bound to every
  // interface that router answers the internet too, which is not what the mode
  // means. `domain` is the deliberate version of the same thing.
  if (context.config.profile === 'remote-public' && context.config.webEnabled && context.config.webExpose === 'vpn') {
    throw new RefusedError('the panel must not be routed on the tailnet hostname while Traefik binds every interface',
      "portta web up --expose domain   routes it on the gateway's own domain, behind the same login page")
  }
  const dashboardRefusal = dashboardExposeRefusal(context.env)
  if (dashboardRefusal) throw new RefusedError(dashboardRefusal)
  const output = new Output(globals(command))
  const builds = buildsLocally(command)
  output.step('gateway components')
  await requireDocker()
  await requireLocalRelease(context)
  // Both networks are `external: true` in the overlays, so Compose refuses to
  // start until they exist. The shell entry point creates both; this created
  // only the shared one, so `PORTTA_TCP=true portta up` failed here and
  // succeeded there.
  await ensureNetwork(context.config.network)
  if (context.config.tcpEnabled) await ensureNetwork(context.config.accessNetwork)
  ensureAuthState(context.root)
  // The wait is named before it happens, not after: on a cold cache this one
  // step builds the panel image and is the longest part of `portta dev`.
  output.progress(builds
    ? 'migrating the authentication schema; the first run builds the panel image and takes several minutes'
    : 'migrating the authentication schema')
  await migrateAuthState(command)
  output.progress(builds ? 'starting components, building local images' : 'starting components')
  const wait = !options.attach
  const started = await compose(command, [
    'up',
    options.attach ? '' : '-d',
    ...(builds ? ['--build'] : []),
    options.attach ? '' : '--remove-orphans',
    ...(wait ? ['--wait', '--wait-timeout', '180'] : []),
  ].filter(Boolean), 'inherit', wait ? { reject: false } : {})
  if (wait && started.exitCode !== 0) {
    throw new PreconditionError(
      'the gateway did not report healthy within 180s',
      'portta logs   shows what it is doing; portta doctor checks the rest',
    )
  }

  await refreshRepositories(context.config.profile, output)
  await ensureMetricsCollector(context.config.profile, output)

  // The optional applier, so the panel can recreate these containers itself.
  // Off unless PORTTA_APPLY=true, and never fatal: the gateway is up either way.
  const applier = await ensureApplier(context)
  if (applier.action === 'created') output.progress('ok       applier ready; the panel can apply settings without a terminal')
  if (applier.action === 'removed') output.progress('ok       applier removed (PORTTA_APPLY is false)')
  if (applier.action === 'refused') output.progress(`warn     not preparing the applier: ${applier.reason}`)
  if (applier.action === 'failed') output.progress(`warn     ${applier.reason}; settings still apply with: portta up`)

  const runner = await ensureRunner(context)
  if (runner.action === 'created') output.progress('ok       runner ready; the panel can operate a project without a terminal')
  if (runner.action === 'removed') output.progress('ok       runner removed (PORTTA_RUNNER is false)')
  if (runner.action === 'refused') output.progress(`warn     not preparing the runner: ${runner.reason}`)
  if (runner.action === 'failed') output.progress(`warn     ${runner.reason}; project operations still run from a shell`)

  if (options.demo) {
    await applyDemo(command, { ensurePanel: true })
    await urlsCommand({}, command)
  }
}

/**
 * Complete checkout development setup: local Dockerfiles only, never the
 * published GHCR images. Just calls this; an installed PORTTA_HOME keeps `up`.
 * `--reset` wipes the panel database first; `--demo` starts docker/examples
 * and imports their panel records. `portta reset` is this command with `--reset`.
 */
export async function devCommand(
  profile: string | undefined,
  options: { reset?: boolean; demo?: boolean },
  command: Command,
): Promise<void> {
  if (profile) command.setOptionValueWithSource('profile', profile, 'cli')
  const existing = gatewayContext({ profile: profile ?? globals(command).profile, required: false })
  const needsBootstrap = !existsSync(join(existing.root, '.env'))
  // What the whole run will do, before the first step of it starts. `dev` is
  // the longest command here and the one most likely to be mistaken for a hang.
  new Output(globals(command)).progress(`dev runs: ${[
    ...(options.reset ? ['wipe the panel database'] : []),
    ...(options.reset && options.demo ? ['stop docker/examples'] : []),
    ...(needsBootstrap ? ['prepare the checkout'] : []),
    'start gateway components',
    'start the panel',
    ...(options.demo ? ['start docker/examples and import their panel records'] : []),
    'list routed hostnames',
  ].join(' -> ')}`)
  if (options.reset) {
    await wipePanelDatabase(command)
    if (options.demo) await demoStacksDown(command)
  }
  if (needsBootstrap) {
    command.setOptionValueWithSource('yes', true, 'cli')
    await bootstrapCommand({ skipPull: true }, command)
  }
  persistEnv(gatewayContext({ profile: profile ?? globals(command).profile }).root, checkoutLocalEnv())
  // Prepare the panel's credentials, ownership and generated ForwardAuth
  // state before the one Compose convergence that starts the whole gateway.
  const panel = prepareWebUp({ dev: true }, command)
  await upCommand(profile, { attach: false }, command)
  await finishWebUp(panel, command, false)
  if (options.demo) await applyDemo(command, { ensurePanel: false })
  await urlsCommand({}, command)
}

export async function downCommand(options: { demo?: boolean }, command: Command): Promise<void> {
  if (options.demo) await demoStacksDown(command)
  await compose(command, ['down'])
  // The applier lives outside the Compose project, so `down` does not see it.
  // `up` recreates it, and leaving a stopped gateway container behind is the one
  // thing `down` does to nothing else.
  await removeApplier()
  await removeRunner()
  stopMetricsCollector(globals(command).profile, new Output(globals(command)))
}

export function panelDatabaseVolume(env: NodeJS.ProcessEnv): string {
  return env['PORTTA_DB_VOLUME'] || 'portta-db'
}

/** Snapshots the collector and `repos scan` rewrite. Never `state/` itself. */
export const REGENERABLE_STATE_DIRS = ['state/git', 'state/metrics'] as const

export function clearRegenerableState(root: string): string[] {
  const cleared: string[] = []
  for (const relative of REGENERABLE_STATE_DIRS) {
    const directory = join(root, relative)
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      rmSync(join(directory, entry.name), { recursive: true, force: true })
    }
    cleared.push(relative)
  }
  return cleared
}

/**
 * Recreate a checkout as if it were new: the panel database is gone, then
 * `dev` runs again. Project containers and their volumes stay where they are.
 */
export async function wipePanelDatabase(command: Command): Promise<void> {
  await confirm('wipe the panel database and restart this checkout as if it were new?', globals(command).yes === true)
  await requireDocker()
  const context = gatewayContext({ profile: globals(command).profile })
  const output = new Output(globals(command))
  output.step('panel database')
  await downCommand({}, command)
  const volume = identifier(panelDatabaseVolume(context.env), 'volume')
  const removed = await runProcess('docker', ['volume', 'rm', volume], { reject: false })
  if (removed.exitCode === 0) output.progress(`removed volume ${volume}`)
  else output.progress(`volume ${volume} was already absent`)
  const cleared = clearRegenerableState(context.root)
  if (cleared.length > 0) output.progress(`cleared ${cleared.join(', ')}`)
}

/** Alias for `dev --reset`. Kept so `just reset` stays a one-line call. */
export async function resetCommand(options: { demo?: boolean }, command: Command): Promise<void> {
  await devCommand(undefined, { reset: true, demo: options.demo }, command)
}

export async function restartCommand(command: Command): Promise<void> { await compose(command, ['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '180']) }
export async function logsCommand(service: string | undefined, options: { follow?: boolean; tail?: string }, command: Command): Promise<void> {
  const global = globals(command)
  if (global.json) {
    const result = await compose(command, ['logs', '--no-color', '--no-log-prefix', '--tail', options.tail ?? '200', ...(service ? [service] : [])], 'pipe')
    new Output(global).data({ lines: result.stdout.split('\n').filter(Boolean) })
  } else await compose(command, ['logs', ...(options.follow === false ? [] : ['--follow']), '--tail', options.tail ?? '200', ...(service ? [service] : [])])
}

export async function updateCommand(command: Command): Promise<void> {
  prepareEnvFile(join(gatewayContext({ profile: globals(command).profile }).root, '.env'))
  await compose(command, ['config', '--quiet'])
  await compose(command, ['pull', '--ignore-buildable'])
  await confirm('recreate gateway components with the pulled images?', globals(command).yes === true)
  await compose(command, ['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '180'])
}

export async function inspectCommand(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  const output = new Output(options)
  const secrets = new Set(['TS_AUTHKEY', 'CF_DNS_API_TOKEN', 'PORTTA_RUNTIME_DATABASE_URL', 'PORTTA_RUNTIME_DB_PASSWORD', 'PORTTA_AUTH_SECRET'])
  const configuration = Object.fromEntries(Object.entries(context.env).filter(([key]) => key.startsWith('PORTTA_') || ['TLS_ENABLED', 'TLS_MODE', 'PUBLIC_DOMAIN', 'PRIVATE_DOMAIN', 'TAILSCALE_ENABLED'].includes(key)).map(([key, value]) => [key, secrets.has(key) ? (value ? '<set>' : '<unset>') : value]))
  if (output.json) output.data({ profile: context.config.profile, configuration, composeFiles: context.composeFiles })
  else {
    output.line(`profile: ${context.config.profile}`)
    for (const [key, value] of Object.entries(configuration).sort()) output.line(`${key}=${value}`)
    output.line(`compose files: ${context.composeFiles.join(', ')}`)
  }
}

export async function statusCommand(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  const containers = await inspectContainers()
  const routes = routesFor(containers, context.config.domain, context.config.tlsEnabled ? 'https' : 'http')
  const gateway = containers.filter((container) => container.labels['portta.managed'] === 'true')
  const status = {
    version: context.version,
    instance: { name: context.config.projectName },
    profile: context.config.profile,
    domain: context.config.domain,
    bindAddress: context.config.bindAddress,
    network: { name: context.config.network, exists: await networkExists(context.config.network) },
    components: gateway.map((container) => ({ name: container.name, state: container.state, component: container.labels['portta.component'] ?? null })),
    projectCount: projectsFor(containers, context.config.domain, context.config.tlsEnabled ? 'https' : 'http').length,
    routeCount: routes.length,
    tls: context.config.tlsEnabled,
    public: context.config.publicEnabled,
  }
  const output = new Output(options)
  if (output.json) output.data(status)
  else {
    output.line(`portta ${status.version} · ${status.profile} · ${status.domain}`)
    output.line(`network ${status.network.exists ? 'ready' : 'missing'} · ${status.components.length} components · ${status.routeCount} routes`)
    for (const component of status.components) output.line(`${component.component ?? component.name}\t${component.state}`)
  }
}

// `warn` comes from the shell doctor, which distinguishes "worth knowing"
// from "broken": an absent GitHub CLI is not a reason to fail a run.
export interface Check { id: string; status: 'pass' | 'warn' | 'fail'; message: string; fix?: string }

/**
 * What `doctor` prints, as data.
 *
 * A fix belongs to a check that did not pass: printed under `ok` it reads as an
 * instruction to repair something that is already right.
 */
export function doctorReport(checks: Check[]): { line: string; hint?: string }[] {
  return checks.map((check) => ({
    line: `${check.status === 'pass' ? 'ok  ' : check.status === 'warn' ? 'warn' : 'FAIL'} ${check.message}`,
    ...(check.fix && check.status !== 'pass' ? { hint: check.fix } : {}),
  }))
}

export async function doctorCommand(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  const checks: Check[] = (await runDoctor(context)).map((entry) => ({
    id: entry.id,
    status: entry.status,
    message: `${entry.title}: ${entry.detail}`,
    ...(entry.fix ? { fix: entry.fix } : {}),
  }))

  // Not part of the shared check set: the shell fallback judges the files the
  // shell selects, and a published CLI can be pointed at an installation whose
  // overlay set differs from the one it would choose.
  for (const file of context.composeFiles) {
    checks.push({ id: `compose:${file}`, status: existsSync(join(context.root, file)) ? 'pass' : 'fail', message: `${file} exists` })
  }

  // An alias pins a container name, so a recreated environment leaves a router
  // pointing at nothing. Traefik reports no error for that; this does.
  const aliases = readAliases(context.root)
  if (aliases.length > 0) {
    const running = new Set((await inspectContainers()).map((container) => container.name))
    const dangling = aliases.filter((alias) => !running.has(alias.container))
    checks.push(dangling.length === 0
      ? { id: 'aliases', status: 'pass', message: `${aliases.length} hostname alias(es) routed` }
      : { id: 'aliases', status: 'fail', message: `alias target missing: ${dangling.map((alias) => `${alias.host} -> ${alias.container}`).join(', ')}`, fix: 'remove the alias in the panel, or start the environment again' })
  }

  const failed = checks.filter((entry) => entry.status === 'fail')
  const output = new Output(options)
  if (output.json) output.data({ ok: failed.length === 0, instance: { name: context.config.projectName }, checks })
  else for (const entry of doctorReport(checks)) {
    output.line(entry.line)
    if (entry.hint) output.hint(entry.hint)
  }
  if (failed.length) throw new CliError(`${failed.length} doctor check(s) failed`)
}

/**
 * Panel-created aliases live in a generated Traefik file, so the CLI can read
 * the same routing the panel wrote instead of disagreeing with it.
 */
export function readAliases(root: string): StoredAlias[] {
  const path = join(root, 'config/traefik/dynamic/portta-aliases.yaml')
  if (!existsSync(path)) return []
  try { return parseAliases(readFileSync(path, 'utf8')) } catch { return [] }
}

export async function urlsCommand(options: { project?: string }, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const scheme = context.config.tlsEnabled ? 'https' : 'http'
  const derived = routesFor(await inspectContainers(), context.config.domain, scheme)
    .map((route) => ({ ...route, alias: false }))
  const aliases = readAliases(context.root).map((alias) => ({
    project: alias.project,
    service: alias.service,
    container: alias.container,
    hostname: alias.host,
    url: `${scheme}://${alias.host}`,
    port: String(alias.port),
    state: 'alias',
    alias: true,
  }))
  const routes = [...derived, ...aliases]
    .filter((route) => !options.project || route.project === options.project)
    .sort((left, right) => left.hostname.localeCompare(right.hostname))
  const output = new Output(global)
  if (output.json) output.data({ instance: { name: context.config.projectName }, routes, urls: routes })
  else for (const route of routes) output.line(`${route.url}\t${route.project ?? '-'}\t${route.service ?? route.container}${route.alias ? '\talias' : ''}`)
}
