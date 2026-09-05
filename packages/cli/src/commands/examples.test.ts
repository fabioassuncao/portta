import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { ExampleDocument } from 'portta-core'

const mocks = vi.hoisted(() => ({
  requests: [] as { method: string; url: string; body: unknown }[],
  root: '/tmp/portta',
  runProcess: vi.fn(),
  webUp: vi.fn(),
}))
vi.mock('../context.js', () => ({
  gatewayContext: () => ({
    root: mocks.root,
    env: { PORTTA_WEB_PORT: '8081', PORTTA_TOKEN: 'ptt_secret' },
    config: {},
    composeFiles: [],
    version: 'test',
  }),
}))
vi.mock('../process.js', () => ({ runProcess: mocks.runProcess }))
vi.mock('./web.js', () => ({ webUp: mocks.webUp }))

import { applyDemo, demoStacksDown, demoStacksUp, exampleComposeArgs, examplesApply, findExampleManifests, findExampleStacks, panelIsReachable, tasksImport, waitForPanel } from './examples.js'

function command(globals: Record<string, unknown> = {}): Command {
  return { optsWithGlobals: () => ({ json: true, ...globals }) } as unknown as Command
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const shopManifest = join(repoRoot, 'docker/examples/demo-shop/portta.example.json')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.requests.length = 0
  mocks.root = '/tmp/portta'
  mocks.runProcess.mockReset()
  mocks.webUp.mockReset()
})

function stubPanel(health: 'up' | 'down' = 'up') {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (String(url).includes('/api/health')) {
      if (health === 'down') throw new Error('ECONNREFUSED')
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    mocks.requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'GET' && /\/projects\/[^/]+$/.test(url)) {
      return new Response('', { status: 404 })
    }
    if (method === 'POST' && url.endsWith('/projects')) {
      return new Response(JSON.stringify({ slug: 'demo-shop' }), { status: 201, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'POST' && url.includes('/tasks/import')) {
      return new Response(JSON.stringify({ created: 2, updated: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
}

describe('portta examples', () => {
  it('finds every portta.example.json under docker/examples', () => {
    const found = findExampleManifests(repoRoot)
    expect(found.some((path) => path.endsWith('demo-shop/portta.example.json'))).toBe(true)
    expect(found.some((path) => path.endsWith('demo-monorepo/portta.example.json'))).toBe(true)
    expect(found.some((path) => path.endsWith('demo-a/portta.example.json'))).toBe(true)
    expect(found.some((path) => path.endsWith('demo-b/portta.example.json'))).toBe(true)
    expect(found.some((path) => path.endsWith('demo-site/portta.example.json'))).toBe(true)
    expect(found.some((path) => path.includes('demo-external'))).toBe(false)
  })

  it('every discovered manifest is a valid ExampleDocument', () => {
    for (const path of findExampleManifests(repoRoot)) {
      expect(() => ExampleDocument.parse(JSON.parse(readFileSync(path, 'utf8')))).not.toThrow()
    }
  })

  it('creates the project when it is missing, then posts the document', async () => {
    stubPanel()
    await examplesApply({ file: shopManifest }, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'GET', url: 'http://127.0.0.1:8081/api/projects/demo-shop' })
    expect(mocks.requests[1]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/projects', body: { slug: 'demo-shop', name: 'Demo Shop' } })
    expect(mocks.requests[2]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/projects/demo-shop/tasks/import' })
    expect(mocks.requests[2]!.body).toMatchObject({ schemaVersion: 1, project: { slug: 'demo-shop' } })
  })

  it('imports one file into a named project', async () => {
    stubPanel()
    await tasksImport({ project: 'produto', file: shopManifest }, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/projects/produto/tasks/import' })
  })

  it('requires --file and --project for tasks import', async () => {
    stubPanel()
    await expect(tasksImport({ file: shopManifest }, command())).rejects.toThrow(/--project/)
    await expect(tasksImport({ project: 'produto' }, command())).rejects.toThrow(/--file/)
  })
})

describe('demo stacks', () => {
  it('discovers every compose project under docker/examples', () => {
    const stacks = findExampleStacks(repoRoot)
    const names = stacks.map((stack) => stack.name)
    expect(names).toEqual(['demo-a', 'demo-b', 'demo-external', 'demo-monorepo', 'demo-shop', 'demo-site'])
  })

  it('uses the Portta overlay when it exists, and compose.yaml alone when it does not', () => {
    const stacks = Object.fromEntries(findExampleStacks(repoRoot).map((stack) => [stack.name, stack]))
    expect(stacks['demo-a']).toMatchObject({ overlay: true, files: ['compose.yaml', 'compose.portta.yaml'] })
    expect(stacks['demo-external']).toMatchObject({ overlay: false, files: ['compose.yaml'] })
    expect(exampleComposeArgs(stacks['demo-a']!, 'up')).toEqual(['compose', '-f', 'compose.yaml', '-f', 'compose.portta.yaml', 'up', '-d'])
    expect(exampleComposeArgs(stacks['demo-external']!, 'down')).toEqual(['compose', '-f', 'compose.yaml', 'down', '-v'])
    expect(exampleComposeArgs(stacks['demo-a']!, 'up').join(' ')).not.toContain('compose.portta-tcp.yaml')
  })

  it('starts every stack with docker compose up -d', async () => {
    mocks.root = repoRoot
    mocks.runProcess.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, failed: false })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await demoStacksUp(command())
    const calls = mocks.runProcess.mock.calls.map((call) => ({ args: call[1] as string[], cwd: (call[2] as { cwd?: string }).cwd }))
    expect(calls.some((call) => call.cwd?.endsWith('docker/examples/demo-a') && call.args.includes('up'))).toBe(true)
    expect(calls.some((call) => call.cwd?.endsWith('docker/examples/demo-external') && call.args.includes('up'))).toBe(true)
    expect(calls.every((call) => call.args[0] === 'compose' && call.args.includes('-d'))).toBe(true)
  })

  it('stops every stack with docker compose down -v', async () => {
    mocks.root = repoRoot
    mocks.runProcess.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, failed: false })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await demoStacksDown(command())
    const calls = mocks.runProcess.mock.calls.map((call) => call[1] as string[])
    expect(calls.every((args) => args.includes('down') && args.includes('-v'))).toBe(true)
  })
})

describe('applyDemo', () => {
  it('waits for the panel before starting stacks, then imports', async () => {
    mocks.root = repoRoot
    const order: string[] = []
    mocks.runProcess.mockImplementation(async () => {
      order.push('stacks')
      return { stdout: '', stderr: '', exitCode: 0, failed: false }
    })
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (String(url).includes('/api/health')) {
        order.push('health')
        return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      mocks.requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (method === 'GET' && /\/projects\/[^/]+$/.test(url)) return new Response('', { status: 404 })
      if (method === 'POST' && url.endsWith('/projects')) return new Response('{}', { status: 201 })
      if (method === 'POST' && String(url).includes('/tasks/import')) {
        return new Response(JSON.stringify({ created: 2, updated: 0 }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await applyDemo(command(), { ensurePanel: true })

    expect(mocks.webUp).not.toHaveBeenCalled()
    expect(order.indexOf('health')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('health')).toBeLessThan(order.indexOf('stacks'))
    expect(mocks.requests.some((request) => request.method === 'POST' && String(request.url).includes('/tasks/import'))).toBe(true)
  })

  it('starts the panel when --demo needs it and it is not running', async () => {
    mocks.root = repoRoot
    mocks.runProcess.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, failed: false })
    let health: 'up' | 'down' = 'down'
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (String(url).includes('/api/health')) {
        if (health === 'down') throw new Error('ECONNREFUSED')
        return new Response('{"ok":true}', { status: 200 })
      }
      mocks.requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (method === 'GET' && /\/projects\/[^/]+$/.test(url)) return new Response('', { status: 404 })
      if (method === 'POST' && url.endsWith('/projects')) return new Response('{}', { status: 201 })
      if (method === 'POST' && String(url).includes('/tasks/import')) return new Response(JSON.stringify({ created: 0, updated: 1 }), { status: 200 })
      return new Response('{}', { status: 200 })
    })
    mocks.webUp.mockImplementation(async () => { health = 'up' })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await applyDemo(command(), { ensurePanel: true })

    expect(mocks.webUp).toHaveBeenCalledTimes(1)
    expect(mocks.requests.some((request) => request.method === 'POST' && String(request.url).includes('/tasks/import'))).toBe(true)
  })

  it('reports the panel as unreachable when health fails', async () => {
    stubPanel('down')
    expect(await panelIsReachable(command())).toBe(false)
  })

  it('times out instead of hanging when the panel never answers', async () => {
    stubPanel('down')
    await expect(waitForPanel(command(), 0)).rejects.toThrow(/did not become reachable/)
  })
})
