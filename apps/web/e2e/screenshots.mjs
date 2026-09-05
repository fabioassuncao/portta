#!/usr/bin/env node
// Regenerates the panel screenshots used by README.md and docs/web-ui.md.
//
//   npm run screenshots
//
// It boots the real panel against the documentation host in demo-host.mjs and
// a disposable PostgreSQL that receives docker/examples, so the images are
// reproducible, always show the same thing, and never contain whatever happens
// to be running on the machine that generated them.
//
// Every shot uses the same viewport. The main column scrolls; long pages set
// scrollTo rather than growing the frame.

import { execFileSync } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const repo = join(root, '..', '..')
const outDir = join(repo, 'docs', 'images')
const examplesDir = join(repo, 'docker', 'examples')

const DOCKER_PORT = 9931
const PANEL_PORT = 9932
const PG_PORT = 55433
const PG_NAME = 'portta-screenshots-pg'
const DATABASE_URL = `postgres://postgres:screenshots@127.0.0.1:${PG_PORT}/portta`
const BASE = `http://127.0.0.1:${PANEL_PORT}`

const VIEWPORT = { width: 1440, height: 900 }

// The host collector never runs here, so the Overview would open on
// "Unavailable". This is the snapshot it would have written on the
// documentation host: a laptop with room, refreshed so it never goes stale.
const GB = 1024 ** 3
const HOST_SNAPSHOT = {
  version: 1,
  instance: { id: 'e0f1c2d3-0000-4000-8000-documentation', name: 'workstation', hostname: 'workstation' },
  collectedAt: 0,
  host: {
    hostname: 'workstation',
    manufacturer: 'Apple Inc.',
    model: 'Mac15,6',
    productName: 'MacBook Pro (14-inch, M3 Pro, Nov 2023)',
    kind: 'notebook',
    architecture: 'arm64',
    virtual: false,
    platform: 'darwin',
    distro: 'macOS',
    version: '26.5.2',
    release: 'Tahoe',
    kernel: '25.5.0',
    uptimeSeconds: 17 * 86_400 + 3 * 3_600,
    cpu: { manufacturer: 'Apple', brand: 'Apple M3 Pro', physicalCores: 12, logicalCores: 12, speed: null, speedMax: null },
    memoryTotalBytes: 36 * GB,
    memoryUsedBytes: 17 * GB,
    memoryAvailableBytes: 19 * GB,
    memoryUsedPercent: 17 / 36,
    swapTotalBytes: null,
    swapUsedBytes: null,
    cpuUtilisation: 0.23,
    cpuIdle: 0.77,
    load: { one: 2.14, five: 1.86, fifteen: 1.62 },
    storage: { path: '/srv/portta', mount: '/', filesystem: 'apfs', totalBytes: 460 * GB, usedBytes: 190 * GB, availableBytes: 270 * GB, usedPercent: 190 / 460 },
    gpu: [{ vendor: 'Apple', model: 'Apple M3 Pro', vramBytes: null, utilisation: null, temperature: null }],
    temperatureCelsius: null,
    battery: { hasBattery: true, percent: 1, charging: false, acConnected: true, minutesRemaining: null, cycleCount: 143 },
  },
  runtime: { name: 'orbstack' },
  projects: [
    { id: 'demo-shop', name: 'demo-shop', composeProject: 'demo-shop', cpuUtilisation: 0.012, memoryUsedBytes: 564 * 1024 ** 2, containerCount: 4, networkRxBytes: 0, networkTxBytes: 0, containers: [] },
    { id: 'demo-monorepo', name: 'demo-monorepo', composeProject: 'demo-monorepo', cpuUtilisation: 0.004, memoryUsedBytes: 210 * 1024 ** 2, containerCount: 3, networkRxBytes: 0, networkTxBytes: 0, containers: [] },
    { id: 'demo-a', name: 'demo-a', composeProject: 'demo-a', cpuUtilisation: 0.02, memoryUsedBytes: 35 * 1024 ** 2, containerCount: 1, networkRxBytes: 0, networkTxBytes: 0, containers: [] },
  ],
}

const metricsDir = mkdtempSync(join(tmpdir(), 'portta-screenshots-metrics-'))
// The store the ForwardAuth diagnostics look for. Empty is a valid store: no
// hostname is protected on this fake host, which is the truth about it.
writeFileSync(join(metricsDir, 'protections.json'), JSON.stringify({ version: 1, protections: [] }), { mode: 0o600 })

function writeHostSnapshot() {
  writeFileSync(join(metricsDir, 'current.json'), JSON.stringify({ ...HOST_SNAPSHOT, collectedAt: Math.floor(Date.now() / 1000) }))
}

// What the documentation shows.
//
// One entry per page that exists. The rest — projects, tasks, environments,
// services, Docker, network, gateway, settings — come back as each page is
// ported to the App Router, and their shots come back with them; a shot of a
// 404 is worse than a missing shot.
// Every image the documentation embeds, in the order a reader meets them.
//
// A shot names the route and one string that proves the page finished: waiting
// for the network to go quiet is not enough on a page whose content arrives
// from a query, and a screenshot taken a moment early is a screenshot of a
// skeleton. `ready` is that string, `before` is anything that has to be clicked
// first, and `scrollTo` moves the main column rather than growing the frame.
const SHOTS = [
  { name: 'panel-overview', route: '/overview', ready: 'Demo Shop' },
  { name: 'panel-overview-dark', route: '/overview', ready: 'Demo Shop', theme: 'dark' },
  { name: 'panel-projects', route: '/projects', ready: 'Demo Shop' },
  {
    name: 'panel-projects-table',
    route: '/projects?view=table',
    ready: 'Demo Shop',
  },
  { name: 'panel-tasks', route: '/projects/demo-shop/tasks', ready: 'Demo Shop' },
  {
    name: 'panel-tasks-table',
    route: '/projects/demo-shop/tasks?view=table',
    ready: 'Demo Shop',
  },
  { name: 'panel-environments', route: '/environments', ready: 'demo-a' },
  { name: 'panel-environment', route: '/environments/demo-a', ready: 'demo-a' },
  { name: 'panel-services', route: '/services', ready: 'Services' },
  { name: 'panel-docker', route: '/docker', ready: 'Docker' },
  { name: 'panel-docker-external', route: '/docker', ready: 'Docker', scrollTo: 1200 },
  { name: 'panel-network', route: '/network', ready: 'Network' },
  { name: 'panel-access', route: '/access', ready: 'Access' },
  { name: 'panel-gateway', route: '/gateway', ready: 'Gateway' },
  { name: 'panel-settings', route: '/settings/general/project-access', ready: 'Settings' },
  { name: 'panel-docs', route: '/docs', ready: 'Portta docs' },
  // The task's own workspace. Its id is whatever the import produced, so the
  // shot opens the board and clicks the first card rather than guessing one.
  {
    name: 'panel-task',
    route: '/projects/demo-shop/tasks',
    ready: 'Demo Shop',
    before: async (page) => {
      await page.getByRole('article').first().click()
      await page.waitForURL(/\/projects\/demo-shop\/tasks\/\d+/, { timeout: 10_000 })
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(600)
    },
  },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function startPostgres() {
  try { execFileSync('docker', ['rm', '-f', PG_NAME], { stdio: 'ignore' }) } catch { /* absent */ }
  execFileSync('docker', [
    'run', '-d', '--rm', '--name', PG_NAME,
    '-e', 'POSTGRES_PASSWORD=screenshots',
    '-e', 'POSTGRES_DB=portta',
    '-p', `${PG_PORT}:5432`,
    'postgres:18.6-alpine',
  ], { stdio: 'inherit' })
}

function stopPostgres() {
  try { execFileSync('docker', ['rm', '-f', PG_NAME], { stdio: 'ignore' }) } catch { /* already gone */ }
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      execFileSync('docker', ['exec', PG_NAME, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' })
      return
    } catch {
      await sleep(500)
    }
  }
  throw new Error('screenshot postgres did not become ready')
}

async function waitForPanel() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error('the panel did not come up')
}

async function waitForDatabase() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/projects`)
      if (response.ok) return
    } catch {
      /* not ready */
    }
    await sleep(500)
  }
  throw new Error('the panel database did not become ready')
}

async function seedExamples() {
  const directories = readdirSync(examplesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  for (const directory of directories) {
    const path = join(examplesDir, directory.name, 'portta.example.json')
    if (!existsSync(path)) continue
    const document = JSON.parse(readFileSync(path, 'utf8'))
    const slug = document.project.slug
    const existing = await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}`)
    if (existing.status === 404) {
      const created = await fetch(`${BASE}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug,
          name: document.project.name,
          description: document.project.description ?? null,
        }),
      })
      if (!created.ok) throw new Error(`create ${slug}: ${created.status} ${await created.text()}`)
    } else if (!existing.ok) {
      throw new Error(`get ${slug}: ${existing.status} ${await existing.text()}`)
    }
    const imported = await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}/tasks/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(document),
    })
    if (!imported.ok) throw new Error(`import ${slug}: ${imported.status} ${await imported.text()}`)
    process.stdout.write(`seeded ${slug}\n`)
  }
}

mkdirSync(outDir, { recursive: true })
writeHostSnapshot()
const collector = setInterval(writeHostSnapshot, 3_000)
startPostgres()
await waitForPostgres()

const harness = spawn(process.execPath, [join(here, 'harness.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORTTA_E2E_FIXTURE: './demo-host.mjs',
    PORTTA_TCP: 'true',
    PORTTA_E2E_DOCKER_PORT: String(DOCKER_PORT),
    PORTTA_E2E_PANEL_PORT: String(PANEL_PORT),
    PORTTA_RUNTIME_DB_MODE: 'external',
      PORTTA_RUNTIME_DATABASE_URL: DATABASE_URL,
    PORTTA_RUNTIME_METRICS_DIR: metricsDir,
    // A signing secret and a protection store, so the Overview shows a healthy
    // host rather than three findings about the harness it is running in.
    PORTTA_AUTH_SECRET: 'a-screenshot-secret-long-enough-to-sign',
    PORTTA_RUNTIME_AUTH_STORE: join(metricsDir, 'protections.json'),
  },
})

try {
  await waitForPanel()
  await waitForDatabase()
  await seedExamples()

  const browser = await chromium.launch()
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      colorScheme: shot.theme === 'dark' ? 'dark' : 'light',
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    await page.goto(BASE + shot.route)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(900)
    if (shot.ready) await page.getByText(shot.ready).first().waitFor({ timeout: 10_000 })
    if (shot.before) await shot.before(page)
    if (shot.scrollTo) {
      await page.evaluate((top) => document.querySelector('main')?.scrollTo({ top }), shot.scrollTo)
      await page.waitForTimeout(400)
    }
    await page.waitForTimeout(300)

    const file = join(outDir, `${shot.name}.png`)
    await page.screenshot({ path: file })
    process.stdout.write(`wrote ${file}\n`)
    await context.close()
  }
  await browser.close()
} finally {
  clearInterval(collector)
  harness.kill('SIGTERM')
  stopPostgres()
  rmSync(metricsDir, { recursive: true, force: true })
}
