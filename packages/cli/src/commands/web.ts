import { patchEnvFile, prepareEnvFile } from 'portta-core'
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  PANEL_ACCESS_MODES,
  isPanelAccess,
  isTrue,
  readProtectionStore,
  removeProtection,
  renderAuthDynamic,
  renderPanelAuth as renderSharedPanelAuth,
  writeEnvFile,
  writeProtectionStore,
  porttaImages,
} from 'portta-core'
import type { Command } from 'commander'
import { composeArguments, gatewayContext } from '../context.js'
import { ensureNetwork, inspectContainers } from '../docker.js'
import { CliError, EXIT, PreconditionError, RefusedError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { requireLocalRelease, selectLocalRelease } from '../local-release.js'
import { refreshRepositories } from './repos.js'
import { ensureMetricsCollector, stopMetricsCollector } from './host.js'

function globals(command: Command) { return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string } }

function setValues(root: string, values: Record<string, string>): void {
  const path = join(root, '.env')
  patchEnvFile(path, values)
}

/**
 * Traefik's two Portta-owned files, written from the host.
 *
 * The panel signs people in itself, so neither it nor the Traefik dashboard has
 * a record here any more; a store written by an older Portta still does, and
 * those are removed. What remains is ForwardAuth for project hostnames and
 * shares, which is what `portta protect` writes.
 */
export function syncForwardAuth(root: string): void {
  const storePath = join(root, 'state/auth/protections.json')
  const current = readProtectionStore(storePath)
  const next = removeProtection(removeProtection(current, 'panel'), 'dashboard')
  writeProtectionStore(storePath, next)
  const dynamic = join(root, 'config/traefik/dynamic')
  mkdirSync(dynamic, { recursive: true })
  writeEnvFile(join(dynamic, 'portta-auth.yaml'), renderAuthDynamic(next))
  writeEnvFile(join(dynamic, 'portta-panel.yaml'), renderSharedPanelAuth())
}

/**
 * Every panel command addresses the panel, so it resolves the file list with
 * the panel enabled. Without that, an inherited PORTTA_WEB=false drops the
 * overlays that define these services and Compose answers "no such service",
 * which the callers below deliberately ignore — so the command reports success
 * and does nothing.
 */
const PANEL_OVERRIDES = { PORTTA_WEB: 'true' }

async function webCompose(command: Command, args: string[], extraEnv: NodeJS.ProcessEnv = {}, stdio: 'inherit' | 'pipe' = 'inherit') {
  const context = gatewayContext({ profile: globals(command).profile, overrides: PANEL_OVERRIDES })
  return runProcess('docker', ['compose', ...composeArguments(context), ...args], { cwd: context.root, env: { ...context.env, ...extraEnv }, stdio })
}

export interface WebUpOptions { localRelease?: boolean; expose?: string; port?: string; readOnly?: boolean; writable?: boolean; dev?: boolean }

export interface PreparedWebUp {
  context: ReturnType<typeof gatewayContext>
  values: Record<string, string>
  output: Output
}

/** Persist and resolve everything the panel needs before Compose converges. */
export function prepareWebUp(options: WebUpOptions, command: Command): PreparedWebUp {
  prepareEnvFile(join(gatewayContext({ profile: globals(command).profile }).root, '.env'))
  if (options.localRelease) selectLocalRelease(gatewayContext({ profile: globals(command).profile }))
  const initial = gatewayContext({ profile: globals(command).profile })
  const expose = options.expose ?? initial.config.webExpose
  if (!isPanelAccess(expose)) throw new UsageError(`--expose must be one of: ${PANEL_ACCESS_MODES.join(', ')}`)
  if (expose === 'vpn' && initial.config.profile === 'remote-public') {
    throw new RefusedError('the panel must not be routed on the tailnet hostname while Traefik binds every interface',
      "portta web up --expose domain   routes it on the gateway's own domain, behind the same login page")
  }
  // `domain` is the one routed mode a public profile may have, and only with a
  // hostname to route on: the router matches Host(...), so without one there is
  // nothing to match and the panel would answer nothing.
  if (expose === 'domain') {
    const advertised = initial.env['PORTTA_PANEL_ADVERTISED_HOST'] ?? ''
    if (!advertised || advertised === 'localhost' || /^[0-9.]+$/.test(advertised)) {
      throw new RefusedError(`panel access 'domain' needs a hostname to route on, and this host advertises ${advertised || 'nothing'}`,
        'portta config set panel.host portta.example.com')
    }
    if (!initial.config.tlsEnabled) {
      throw new RefusedError("a panel routed on the domain would carry its session cookie in clear text",
        'enable TLS first: portta config set tls.enabled true')
    }
  }
  // Anything the panel can be reached on from another machine has to ask who is
  // asking. `local` is the only mode that does not: it publishes on loopback,
  // where reaching the panel already means having the machine. `tailscale`
  // binds the node's tailnet address, which is another machine's reach.
  //
  // The panel's own process refuses the same combination at boot. This refusal
  // exists so the answer arrives before the container is started, with the
  // command that fixes it.
  const protectedPanel = initial.env['PORTTA_AUTH_MODE'] === 'required'
  if (expose !== 'local' && !protectedPanel) {
    throw new RefusedError(
      `panel access '${expose}' needs the panel to sign people in`,
      'portta config set panel.auth required',
    )
  }
  const readOnly = options.writable ? false : options.readOnly ?? (expose === 'vpn' ? true : initial.config.webReadOnly)
  const values: Record<string, string> = {
    PORTTA_WEB: 'true', PORTTA_WEB_EXPOSE: expose, PORTTA_WEB_READ_ONLY: String(readOnly), PORTTA_WEB_DEV: String(options.dev ?? initial.config.webDev),
  }
  if (options.port) values['PORTTA_WEB_PORT'] = String(Number(options.port))
  // Where a browser reaches the panel, decided here because the exposure is
  // decided here. Three things read it: whether the session cookie may be
  // `Secure`, which origins a write is accepted from, and the address the
  // panel prints. Getting it wrong on a routed panel means a cookie that is
  // never sent back, which looks exactly like a password that does not work.
  if (!initial.env['PORTTA_PANEL_URL'] || options.expose || options.port) values['PORTTA_PANEL_URL'] = panelUrlFor(
    initial,
    expose,
    options.port ? String(Number(options.port)) : String(initial.config.webPort),
  )
  setValues(initial.root, values)
  mkdirSync(join(initial.root, 'state/git'), { recursive: true })
  mkdirSync(join(initial.root, 'state/github'), { recursive: true })
  mkdirSync(join(initial.root, 'state/metrics'), { recursive: true })
  mkdirSync(join(initial.root, 'state/logs'), { recursive: true })
  mkdirSync(join(initial.root, 'state/auth'), { recursive: true, mode: 0o700 })
  chmodSync(join(initial.root, 'state/auth'), 0o700)
  mkdirSync(join(initial.root, 'config/traefik/dynamic'), { recursive: true })
  syncForwardAuth(initial.root)
  // The values just written win over anything inherited: a PORTTA_WEB=false in
  // the environment would otherwise drop the panel overlays and leave Compose
  // starting a service that no longer exists in its file list.
  const context = gatewayContext({ profile: globals(command).profile, overrides: values })
  const output = new Output(globals(command))
  return { context, values, output }
}

export async function webUp(options: WebUpOptions, command: Command): Promise<void> {
  const prepared = prepareWebUp(options, command)
  const { context, output } = prepared
  if (options.localRelease) context.env['PORTTA_LOCAL_RELEASE'] = 'true'
  output.step('panel')
  if (!options.dev) await requireLocalRelease(context)
  await ensureNetwork(context.config.network)
  // Both of these were silent and both can be slow: a cold pull, and — right
  // after `reset` removed the volume — initialising a fresh Postgres cluster.
  // `reject: false` on the second one meant a failure produced no output at all.
  output.progress('pulling alpine/socat:1.8.1.3')
  await runProcess('docker', ['pull', 'alpine/socat:1.8.1.3'], { reject: false, stdio: 'stream' })
  if (context.config.databaseMode === 'managed') {
    output.progress('starting the panel database')
    await runProcess('docker', ['compose', ...composeArguments(context), 'up', '-d', '--wait', '--wait-timeout', '120', 'db'], { cwd: context.root, env: context.env, stdio: 'stream' })
  }
  // The same three in both modes. There used to be a fourth, `web-ui`, running
  // Vite in front of the panel; the panel is one process now, and naming a
  // service the file list no longer defines makes Compose refuse the whole
  // `up` — which is how `web dev` stopped working without anybody noticing.
  const services = ['portta-auth', 'web', 'web-socket-proxy']
  // `--remove-orphans`, as `portta up` already does: leaving development
  // mode drops docker/compose/features/web-dev.yaml from the file list, and without this the
  // Vite container keeps serving a stale panel on its own port.
  // `--build` only where a build overlay is actually applied: an installed
  // PORTTA_HOME has no source tree, and asking Compose to build there fails.
  const buildArgs = context.config.webDev || context.config.webBuild ? ['--build'] : []
  output.progress(buildArgs.length > 0
    ? `starting ${services.join(', ')}, building the panel image`
    : `starting ${services.join(', ')}`)
  const started = await runProcess('docker', ['compose', ...composeArguments(context), 'up', '-d', ...buildArgs, '--remove-orphans', '--wait', '--wait-timeout', '180', ...services], { cwd: context.root, env: context.env, stdio: 'inherit', reject: false })
  // `--wait-timeout` is a health wait, not a build limit: the images are built
  // and the containers exist, they just did not report healthy. Say which
  // question that is, because execa's own message says only "exited with 1".
  if (started.exitCode !== 0) {
    throw new PreconditionError(
      'the panel did not report healthy within 180s',
      'portta web logs   shows what it is doing; portta doctor checks the rest',
    )
  }
  await finishWebUp(prepared, command)
}

/** Report and migrate after either `web up` or the full `dev` convergence. */
export async function finishWebUp(prepared: PreparedWebUp, command: Command, refreshHost = true): Promise<void> {
  const { context, values, output } = prepared
  if (refreshHost) {
    await refreshRepositories(context.config.profile, output)
    await ensureMetricsCollector(context.config.profile, output)
  }
  const running = gatewayContext({ profile: globals(command).profile, overrides: values })
  try {
    const result = await requestPanelMigrate(running)
    if (result.applied.length > 0) output.progress(`applied ${result.applied.join(', ')}`)
    else output.detail(`panel schema is current (${result.migrations.length} migrations)`)
  } catch (error) {
    output.warning(`pending panel migrations were not applied: ${error instanceof Error ? error.message : String(error)}`)
    output.hint(error instanceof CliError && error.hint ? error.hint : 'portta db migrate')
  }
  // The context was resolved before .env was rewritten, so `web dev` would
  // otherwise report the URL the previous mode used.
  const url = webUrl(running)
  // A panel that signs people in has one page until somebody creates the owner,
  // and knowing which one is the difference between an install that finished
  // and one that appears to have started something unreachable.
  const state = await panelSetupState(panelLoopbackApiUrl(running))
  if (state?.setupRequired) {
    output.progress(`this panel has no owner yet: open ${url}/setup to create it`)
    output.hint('portta auth bootstrap --email you@example.com   creates it from this host instead')
  }
  output.data(url)
}

/**
 * Loopback address of the API process itself.
 *
 * `webUrl` is what a person types: Vite in development, Traefik when the
 * panel is routed. Migrations have to reach the Node process, so they dial
 * the published API port and never the UI, the proxy or a credential.
 */
export function panelLoopbackApiUrl(context: ReturnType<typeof gatewayContext>): string {
  const bind = context.env['PORTTA_WEB_BIND_ADDRESS'] ?? '127.0.0.1'
  const host = bind === '0.0.0.0' || bind === '::' || bind === '[::]' ? '127.0.0.1' : bind
  return `http://${host}:${context.config.webPort}`
}

export interface PanelMigrateResult {
  applied: string[]
  migrations: string[]
}

const PANEL_WAIT_MS = 120_000
const PANEL_POLL_MS = 500

export async function waitForPanelLoopback(
  context: ReturnType<typeof gatewayContext>,
  timeoutMs = PANEL_WAIT_MS,
): Promise<void> {
  const url = `${panelLoopbackApiUrl(context)}/api/health`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (response.ok || response.status === 401) return
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, PANEL_POLL_MS))
  }
  throw new PreconditionError('the panel is not reachable', 'run portta web up')
}

export async function requestPanelMigrate(
  context: ReturnType<typeof gatewayContext>,
): Promise<PanelMigrateResult> {
  await waitForPanelLoopback(context)
  const url = `${panelLoopbackApiUrl(context)}/api/database/migrate`
  let response: Response | undefined
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    throw new PreconditionError('the panel is not reachable', 'run portta web up')
  }
  const body = await response!.json().catch(() => ({})) as {
    error?: string
    hint?: string
    applied?: string[]
    migrations?: string[]
  }
  if (!response!.ok) {
    throw new PreconditionError(
      body.error ?? `the panel refused to migrate (HTTP ${response!.status})`,
      body.hint ?? 'run portta db status',
    )
  }
  return { applied: body.applied ?? [], migrations: body.migrations ?? [] }
}

/**
 * Where the panel actually answers.
 *
 * One port in every mode, development included: the panel is one process, and
 * HMR arrives on the same port the API does. There used to be a Vite container
 * on 5173 in front of it, and this function used to report that port.
 */
export function webUrl(context: ReturnType<typeof gatewayContext>): string {
  if (context.config.webExpose === 'vpn') return `${context.config.tlsEnabled ? 'https' : 'http'}://${context.env['PORTTA_WEB_HOST'] ?? 'portta-web'}.${context.config.domain}`
  if (context.config.webExpose === 'domain') {
    return `${context.config.tlsEnabled ? 'https' : 'http'}://${context.env['PORTTA_PANEL_ADVERTISED_HOST'] ?? context.config.domain}`
  }
  // In `public` mode the port belongs to Traefik and 0.0.0.0 is not an address
  // anybody types, so report the host's own reachable address instead.
  if (context.config.webExpose === 'public') {
    const advertised = context.env['PORTTA_PANEL_ADVERTISED_HOST'] || null
    return `http://${advertised ?? '<this-host>'}:${context.config.webPort}`
  }
  const host = context.env['PORTTA_WEB_BIND_ADDRESS'] ?? '127.0.0.1'
  return `http://${host}:${context.config.webPort}`
}

/**
 * The origin a browser will actually be on, for PORTTA_PANEL_URL.
 *
 * Nearly `webUrl`, and deliberately not the same function: that one is written
 * for a person to read and says `<this-host>` when the address is not knowable.
 * This one has to parse as a URL, so where the host is unknown it falls back to
 * loopback and the operator adds the real origin to
 * PORTTA_PANEL_TRUSTED_ORIGINS. Everything the panel derives from it — whether
 * the session cookie may be `Secure`, which origins a sign-in is accepted from
 * — is wrong in a way that looks like a broken password if this is wrong.
 */
export function panelUrlFor(
  context: ReturnType<typeof gatewayContext>,
  expose: string,
  port: string,
): string {
  const scheme = context.config.tlsEnabled ? 'https' : 'http'
  if (expose === 'domain') {
    return `${scheme}://${context.env['PORTTA_PANEL_ADVERTISED_HOST'] ?? context.config.domain}`
  }
  if (expose === 'vpn') {
    return `${scheme}://${context.env['PORTTA_WEB_HOST'] ?? 'portta-web'}.${context.config.domain}`
  }
  if (expose === 'public') {
    const advertised = context.env['PORTTA_PANEL_ADVERTISED_HOST'] || null
    return advertised ? `http://${advertised}:${port}` : `http://127.0.0.1:${port}`
  }
  const bind = context.env['PORTTA_WEB_BIND_ADDRESS'] ?? '127.0.0.1'
  const host = bind === '0.0.0.0' || bind === '::' || bind === '[::]' ? '127.0.0.1' : bind
  return `http://${host}:${port}`
}

/**
 * Whether this panel still has to be set up, and where.
 *
 * `GET /api/auth/status` is public in both modes and is the only thing that can
 * answer it: the owner lives in the database, not in `.env`. A panel that does
 * not answer is not an error here — `up` has already reported that — so this
 * returns null and the caller stays quiet.
 */
export async function panelSetupState(apiUrl: string): Promise<{ mode: string; setupRequired: boolean } | null> {
  try {
    const response = await fetch(`${apiUrl}/api/auth/status`, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) return null
    const body = await response.json() as { mode?: string; setupRequired?: boolean }
    if (typeof body.mode !== 'string') return null
    return { mode: body.mode, setupRequired: body.setupRequired === true }
  } catch {
    return null
  }
}

export async function webDown(command: Command): Promise<void> {
  // The dev overlay is in the file list either way, because the panel container
  // it defines is the same one: a checkout that was last started with
  // `web dev` has to be stopped by a `web down` that resolves the same file.
  const context = gatewayContext({ profile: globals(command).profile, overrides: { ...PANEL_OVERRIDES, PORTTA_WEB_DEV: 'true' } })
  const env = { ...context.env, PORTTA_WEB: 'true', PORTTA_WEB_DEV: 'true' }
  const services = ['db', 'web', 'web-socket-proxy']
  await runProcess('docker', ['compose', ...composeArguments({ ...context, env }), 'stop', ...services], { cwd: context.root, env, reject: false })
  await runProcess('docker', ['compose', ...composeArguments({ ...context, env }), 'rm', '-f', ...services], { cwd: context.root, env, reject: false })
  const output = new Output(globals(command))
  stopMetricsCollector(globals(command).profile, output)
  output.progress('panel stopped; gateway and projects were not touched')
}

export async function webDisable(command: Command): Promise<void> {
  await webDown(command)
  const context = gatewayContext({ profile: globals(command).profile, overrides: PANEL_OVERRIDES })
  setValues(context.root, { PORTTA_WEB: 'false' })
}

export async function webRestart(command: Command): Promise<void> { await webCompose(command, ['restart', 'web', 'web-socket-proxy']) }
export async function webLogs(service: string | undefined, command: Command): Promise<void> {
  const target = service ?? 'web'
  if (!['web', 'web-socket-proxy', 'db', 'portta-auth'].includes(target)) throw new UsageError(`unknown panel service: ${target}`)
  const global = globals(command)
  if (global.json) {
    const result = await webCompose(command, ['logs', '--no-color', '--no-log-prefix', '--tail', '100', target], {}, 'pipe')
    new Output(global).data({ lines: result.stdout.split('\n').filter(Boolean) })
  } else await webCompose(command, ['logs', '--follow', '--tail', '100', target])
}
export async function webBuild(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const image = porttaImages(context.version).runtime
  await runProcess('docker', [
    'build', '--build-arg', `PORTTA_VERSION=${context.version}`, '--target', 'runtime',
    '-f', 'apps/web/Dockerfile', '-t', image, '.',
  ], { cwd: context.root, stdio: 'inherit' })
}

export async function webStatus(command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile, overrides: PANEL_OVERRIDES })
  const containers = await inspectContainers()
  const panel = containers.find((container) => container.labels['portta.component'] === 'web')
  const proxy = containers.find((container) => container.labels['portta.component'] === 'web-socket-proxy')
  // The mode comes from `.env`; whether an owner exists can only come from the
  // panel, because it lives in the database. A panel that is not answering
  // reports `null` rather than a guess.
  const live = panel?.state === 'running' ? await panelSetupState(panelLoopbackApiUrl(context)) : null
  const value = {
    enabled: context.config.webEnabled,
    devMode: isTrue(context.env['PORTTA_WEB_DEV']),
    readOnly: context.config.webReadOnly,
    expose: context.config.webExpose,
    authMode: context.config.authMode,
    setupRequired: live ? live.setupRequired : null,
    url: webUrl(context),
    panel: { state: panel?.state ?? 'absent' },
    socketProxy: { state: proxy?.state ?? 'absent' },
  }
  const output = new Output(global)
  if (output.json) output.data(value)
  else for (const [key, item] of Object.entries(value)) output.line(`${key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`)
}

export async function webOpen(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const url = webUrl(context)
  new Output(globals(command)).data(url)
  const opener = process.platform === 'darwin' ? 'open' : 'xportta-open'
  await runProcess(opener, [url], { reject: false })
}

/**
 * A passthrough to a shell implementation, and now only one: `toolbox`, whose
 * `scripts/lib/toolbox.sh` keeps its *stays shell* verdict in ADR 0029 because
 * it is the `docker run` wrapper the zero-Node path needs.
 *
 * It is transparent in both directions. The child inherits the terminal, so
 * prompts, streaming and Ctrl-C work; and its exit code is adopted verbatim,
 * because wrapping every failure as a precondition would hide which failure
 * happened behind a second, vaguer error.
 */
export async function legacy(commandName: string, args: string[], command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const result = await runProcess(join(context.root, 'bin/portta'), [commandName, ...args], { cwd: context.root, env: { ...context.env, PORTTA_FORCE_BASH: 'true', PORTTA_ASSUME_YES: globals(command).yes ? 'true' : context.env['PORTTA_ASSUME_YES'] }, stdio: 'inherit', reject: false })
  if (result.exitCode !== 0) process.exitCode = result.exitCode ?? EXIT.failure
}
