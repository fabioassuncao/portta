import { prepareEnvFile } from 'portta-core'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Command } from 'commander'
import { composeArguments, findGatewayRoot, gatewayContext } from '../context.js'
import { confirm } from '../confirm.js'
import { ensureNetwork } from '../docker.js'
import { PreconditionError, RefusedError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'

interface SetupOptions { dir?: string; repo?: string; branch?: string; profile?: string; dryRun?: boolean; skipPull?: boolean }
interface SetupStep { step: string; status: 'ok' | 'created' | 'updated' | 'skipped' | 'planned'; detail: string }

function globals(command: Command) { return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string } }
function major(version: string): number { return Number(/^v?(\d+)/.exec(version)?.[1] ?? 0) }

async function available(file: string, args: string[]): Promise<{ ok: boolean; value: string }> {
  const result = await runProcess(file, args, { reject: false })
  return { ok: result.exitCode === 0, value: result.stdout.trim() }
}

export async function setupCommand(options: SetupOptions, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  if (process.platform === 'win32') throw new PreconditionError('setup requires a POSIX host')
  const currentRoot = findGatewayRoot()
  const target = resolve(options.dir ?? currentRoot ?? join(homedir(), 'portta'))
  const repo = options.repo ?? 'https://github.com/fabioassuncao/portta.git'
  const branch = options.branch ?? 'develop'
  const profile = options.profile ?? global.profile ?? 'local'
  const steps: SetupStep[] = []
  const record = (step: string, status: SetupStep['status'], detail: string) => {
    steps.push({ step, status, detail })
    if (!output.json) output.progress(`${status.padEnd(8)} ${detail}`)
  }

  const nodeVersion = process.versions.node
  if (major(nodeVersion) < 22 || (major(nodeVersion) === 22 && Number(nodeVersion.split('.')[1] ?? 0) < 12)) throw new PreconditionError(`Node ${nodeVersion} is too old`, 'Node 22.12 or newer is required for the full CLI')
  record('node', 'ok', `Node ${nodeVersion}`)
  const git = await available('git', ['--version'])
  if (!git.ok) throw new PreconditionError('git is required before setup can run')
  record('git', 'ok', git.value)
  const docker = await available('docker', ['version', '--format', '{{.Server.Version}}'])
  if (!docker.ok || major(docker.value) < 24) throw new PreconditionError('Docker Engine 24 or newer is required', 'setup never installs Docker or invokes a system package manager')
  const compose = await available('docker', ['compose', 'version', '--short'])
  if (!compose.ok || major(compose.value) < 2) throw new PreconditionError('Docker Compose v2 is required')
  record('docker', 'ok', `Docker ${docker.value}, Compose ${compose.value}`)

  const gitDir = join(target, '.git')
  if (options.dryRun) {
    record('checkout', 'planned', existsSync(gitDir) ? `fast-forward ${target}` : `clone ${repo} into ${target}`)
    record('environment', 'planned', `create .env only if absent in ${target}`)
    record('network', 'planned', 'ensure the shared gateway network')
    record('gateway', 'planned', `pull pinned images and start profile ${profile}`)
    if (output.json) output.data({ dryRun: true, target, steps })
    return
  }

  await confirm(`set up Portta in ${target}?`, global.yes === true)
  if (existsSync(target) && !existsSync(gitDir)) throw new RefusedError(`${target} exists and is not a Git checkout`, 'choose an empty --dir; setup never overwrites an unrelated directory')
  if (existsSync(gitDir)) {
    const dirty = await runProcess('git', ['-C', target, 'status', '--porcelain'])
    if (dirty.stdout.trim()) throw new RefusedError(`the checkout at ${target} has local changes`, 'commit or stash them before setup updates the checkout')
    await runProcess('git', ['-C', target, 'fetch', 'origin', branch])
    await runProcess('git', ['-C', target, 'merge', '--ff-only', `origin/${branch}`])
    record('checkout', 'updated', `${target} (${branch})`)
  } else {
    mkdirSync(dirname(target), { recursive: true })
    await runProcess('git', ['clone', '--branch', branch, '--single-branch', repo, target])
    record('checkout', 'created', `${target} (${branch})`)
  }

  const envFile = join(target, '.env')
  prepareEnvFile(envFile)
  record('environment', 'updated', 'environment prepared from .env.example')
  for (const directory of ['state', 'state/auth', 'state/runner', 'state/access', 'state/cloudflared', 'state/git', 'state/github', 'state/metrics', 'state/logs', 'config/tls', 'config/traefik/dynamic']) mkdirSync(join(target, directory), { recursive: true })
  for (const directory of ['state/auth', 'state/runner', 'state/cloudflared']) chmodSync(join(target, directory), 0o700)
  record('directories', 'ok', 'gateway state directories')
  const context = gatewayContext({ root: target, profile })
  const network = await ensureNetwork(context.config.network)
  record('network', network, `shared network ${context.config.network}`)
  if (options.skipPull) record('images', 'skipped', 'image pull disabled')
  else { await runProcess('docker', ['compose', ...composeArguments(context), 'pull', '--ignore-buildable'], { cwd: target, env: context.env }); record('images', 'ok', 'pinned images pulled') }
  await runProcess('docker', ['compose', ...composeArguments(context), 'up', '-d', '--wait', '--wait-timeout', '180'], { cwd: target, env: context.env })
  record('gateway', 'ok', `gateway up on ${profile}`)
  const running = await runProcess('docker', ['compose', ...composeArguments(context), 'ps', '--status', 'running', '--quiet'], { cwd: target, env: context.env })
  if (!running.stdout.trim()) throw new PreconditionError('gateway started but no component remained running', `run portta doctor inside ${target}`)
  record('doctor', 'ok', 'gateway components are running')
  if (output.json) output.data({ dryRun: false, target, steps })
}
