// Apply the declarative example documents under docker/examples/.
//
// `--demo` on up/dev/reset/down is the complete demonstration: the Compose
// stacks and the panel records. `examples apply` remains the data half, for
// tests and for re-seeding without cycling containers. The panel is the only
// writer of those records.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import { EXAMPLE_MANIFEST_NAME, ExampleDocument } from 'portta-core'
import { segment } from '../api.js'
import { gatewayContext } from '../context.js'
import { PreconditionError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { clientFor, workGlobals } from './work.js'
import { webUp } from './web.js'

const OVERLAY_FILE = 'compose.portta.yaml'
const COMPOSE_FILE = 'compose.yaml'
const PANEL_WAIT_MS = 120_000
const PANEL_POLL_MS = 500

export interface ExampleStack {
  name: string
  dir: string
  files: string[]
  overlay: boolean
}

export function findExampleManifests(root: string): string[] {
  const dir = join(root, 'docker', 'examples')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name, EXAMPLE_MANIFEST_NAME))
    .filter((path) => existsSync(path))
    .sort()
}

export function findExampleStacks(root: string): ExampleStack[] {
  const dir = join(root, 'docker', 'examples')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const stackDir = join(dir, entry.name)
      if (!existsSync(join(stackDir, COMPOSE_FILE))) return null
      const overlay = existsSync(join(stackDir, OVERLAY_FILE))
      return {
        name: entry.name,
        dir: stackDir,
        files: overlay ? [COMPOSE_FILE, OVERLAY_FILE] : [COMPOSE_FILE],
        overlay,
      }
    })
    .filter((stack): stack is ExampleStack => stack !== null)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function exampleComposeArgs(stack: ExampleStack, action: 'up' | 'down'): string[] {
  const files = stack.files.flatMap((file) => ['-f', file])
  if (action === 'up') return ['compose', ...files, 'up', '-d']
  return ['compose', ...files, 'down', '-v']
}

function outputFor(command: Command): Output {
  return new Output(workGlobals(command))
}

function examplesRoot(command: Command): string {
  return gatewayContext({ profile: workGlobals(command).profile, required: false }).root
}

export async function demoStacksUp(command: Command): Promise<void> {
  const output = outputFor(command)
  const stacks = findExampleStacks(examplesRoot(command))
  if (stacks.length === 0) return
  output.step('demo stacks')
  for (const stack of stacks) {
    output.progress(`starting ${stack.name}`)
    await runProcess('docker', exampleComposeArgs(stack, 'up'), { cwd: stack.dir, stdio: 'inherit' })
  }
}

export async function demoStacksDown(command: Command): Promise<void> {
  const output = outputFor(command)
  const stacks = findExampleStacks(examplesRoot(command))
  if (stacks.length === 0) return
  output.step('demo stacks')
  for (const stack of stacks) {
    output.progress(`stopping ${stack.name}`)
    await runProcess('docker', exampleComposeArgs(stack, 'down'), { cwd: stack.dir, stdio: 'inherit' })
  }
}

function panelHealthUrl(command: Command): string {
  const context = gatewayContext({ profile: workGlobals(command).profile, required: false })
  const host = context.config.webExpose === 'public' ? '127.0.0.1' : (context.env['PORTTA_WEB_BIND_ADDRESS'] ?? '127.0.0.1')
  const port = context.config.webPort || Number(context.env['PORTTA_WEB_PORT'] ?? 8081)
  return `http://${host}:${port}/api/health`
}

export async function panelIsReachable(command: Command): Promise<boolean> {
  try {
    const response = await fetch(panelHealthUrl(command), { signal: AbortSignal.timeout(3000) })
    return response.ok || response.status === 401
  } catch {
    return false
  }
}

export async function waitForPanel(command: Command, timeoutMs = PANEL_WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await panelIsReachable(command)) return
    await new Promise((resolve) => setTimeout(resolve, PANEL_POLL_MS))
  }
  throw new PreconditionError(
    'the panel did not become reachable in time to import the demonstration',
    'start it with `portta web up` or `portta dev`, then retry with --demo',
  )
}

/** A reachable panel, then stacks, then the declarative import. Idempotent. */
export async function applyDemo(command: Command, options: { ensurePanel?: boolean } = {}): Promise<void> {
  if (options.ensurePanel !== false && !await panelIsReachable(command)) {
    await webUp({}, command)
  }
  await waitForPanel(command)
  await demoStacksUp(command)
  await examplesApply({}, command)
}

export async function examplesApply(options: { file?: string }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const context = gatewayContext({ profile: workGlobals(command).profile, required: false })
  const files = options.file ? [options.file] : findExampleManifests(context.root)
  if (files.length === 0) throw new UsageError(`no ${EXAMPLE_MANIFEST_NAME} under docker/examples; pass --file`)

  for (const path of files) {
    const document = ExampleDocument.parse(JSON.parse(readFileSync(path, 'utf8')))
    const slug = document.project.slug
    const existing = await client.answer('GET', `/projects/${segment(slug)}`)
    if (existing.status === 404) {
      await client.request('POST', '/projects', {
        slug,
        name: document.project.name,
        description: document.project.description ?? null,
      })
      output.progress(`created project ${slug}`)
    } else if (!existing.ok) {
      await client.request('GET', `/projects/${segment(slug)}`)
    }
    const applied = await client.request<{ created: number; updated: number }>('POST', `/projects/${segment(slug)}/tasks/import`, document)
    output.progress(`${slug}: ${applied.created} created, ${applied.updated} updated (${path})`)
    if (output.json) output.data({ path, ...applied })
  }
}

export async function tasksImport(options: { project?: string; file?: string }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  if (!options.file) throw new UsageError('--file is required')
  if (!options.project) throw new UsageError('--project is required')
  const document = ExampleDocument.parse(JSON.parse(readFileSync(options.file, 'utf8')))
  const applied = await client.request<{ created: number; updated: number }>('POST', `/projects/${segment(options.project)}/tasks/import`, document)
  if (output.json) return output.data(applied)
  output.progress(`${options.project}: ${applied.created} created, ${applied.updated} updated`)
}
