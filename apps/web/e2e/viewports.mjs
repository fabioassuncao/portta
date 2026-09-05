#!/usr/bin/env node
// Checks that the panel is usable at every width it is meant for.
//
//   node e2e/viewports.mjs            report only
//   node e2e/viewports.mjs --shots    also write the frames to /tmp for a look
//
// The one thing it asserts is the one thing that actually breaks a layout: the
// page must never scroll sideways. Anything wide — a table, the board, a
// toolbar — has to scroll inside its own container, so `document` staying
// within its viewport is the whole contract. It also fails on a control that
// ends up off-screen, because a button nobody can reach is a broken page.
//
// It boots the same harness the screenshots use, so what it measures is the
// real panel against the documentation host.

import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const repo = join(root, '..', '..')
const examplesDir = join(repo, 'docker', 'examples')

const DOCKER_PORT = 9941
const PANEL_PORT = 9942
const PG_PORT = 55443
const PG_NAME = 'portta-viewports-pg'
const DATABASE_URL = `postgres://postgres:viewports@127.0.0.1:${PG_PORT}/portta`
const BASE = `http://127.0.0.1:${PANEL_PORT}`
const SHOTS = process.argv.includes('--shots')
const OUT = '/tmp/portta-viewports'

const VIEWPORTS = [
  { name: 'desktop-wide', width: 1920, height: 1080 },
  { name: 'laptop', width: 1440, height: 900 },
  { name: 'laptop-small', width: 1280, height: 800 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'tablet-portrait', width: 820, height: 1180 },
]

// The pages that exist. The rest return as each is ported to the App Router.
const TARGETS = [
  { name: 'overview', route: '/overview', ready: 'Demo Shop' },
  { name: 'docs', route: '/docs', ready: 'Portta docs' },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function startPostgres() {
  try { execFileSync('docker', ['rm', '-f', PG_NAME], { stdio: 'ignore' }) } catch { /* absent */ }
  execFileSync('docker', [
    'run', '-d', '--rm', '--name', PG_NAME,
    '-e', 'POSTGRES_PASSWORD=viewports', '-e', 'POSTGRES_DB=portta',
    '-p', `${PG_PORT}:5432`, 'postgres:18.6-alpine',
  ], { stdio: 'ignore' })
}

function stopPostgres() {
  try { execFileSync('docker', ['rm', '-f', PG_NAME], { stdio: 'ignore' }) } catch { /* gone */ }
}

async function waitFor(check, what) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (await check()) return
    } catch { /* not yet */ }
    await sleep(500)
  }
  throw new Error(`${what} did not become ready`)
}

async function seedExamples() {
  for (const entry of readdirSync(examplesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(examplesDir, entry.name, 'portta.example.json')
    if (!existsSync(path)) continue
    const document = JSON.parse(readFileSync(path, 'utf8'))
    const slug = document.project.slug
    const existing = await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}`)
    if (existing.status === 404) {
      await fetch(`${BASE}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, name: document.project.name, description: document.project.description ?? null }),
      })
    }
    await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}/tasks/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(document),
    })
  }
}

startPostgres()
await waitFor(async () => {
  try { execFileSync('docker', ['exec', PG_NAME, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }); return true } catch { return false }
}, 'postgres')

const harness = spawn(process.execPath, [join(here, 'harness.mjs')], {
  cwd: root,
  stdio: 'ignore',
  env: {
    ...process.env,
    PORTTA_E2E_FIXTURE: './demo-host.mjs',
    PORTTA_TCP: 'true',
    PORTTA_E2E_DOCKER_PORT: String(DOCKER_PORT),
    PORTTA_E2E_PANEL_PORT: String(PANEL_PORT),
    PORTTA_RUNTIME_DB_MODE: 'external',
      PORTTA_RUNTIME_DATABASE_URL: DATABASE_URL,
  },
})

const problems = []

try {
  await waitFor(async () => (await fetch(`${BASE}/api/health`)).ok, 'the panel')
  await waitFor(async () => (await fetch(`${BASE}/api/projects`)).ok, 'the panel database')
  await seedExamples()
  if (SHOTS) mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch()
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    for (const target of ROUTES) {
      await page.goto(BASE + target.route)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)
      if (target.ready) {
        await page.getByText(target.ready).first().waitFor({ timeout: 10_000 }).catch(() => {})
      }
      if (target.before) await target.before(page).catch(() => {})
      await page.waitForTimeout(300)

      const measured = await page.evaluate((process_all) => {
        const root = document.documentElement
        const offenders = []
        // Anything sticking out past the viewport, named so the report says
        // which element to fix rather than only that something is wrong.
        for (const element of document.querySelectorAll('body *')) {
          const box = element.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          if (box.right > root.clientWidth + 1) {
            const style = getComputedStyle(element)
            // An element inside its own horizontal scroller is doing what it
            // was told to; only an overflow that reaches the page counts.
            let scrollable = false
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
              const overflow = getComputedStyle(parent).overflowX
              if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') { scrollable = true; break }
            }
            if (scrollable && !process_all) continue
            offenders.push({
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === 'string' ? element.className.slice(0, 90) : '',
              right: Math.round(box.right),
              display: style.display,
            })
          }
        }
        // Every control must say what it is. An icon button with no name is
        // invisible to a screen reader and unnameable in a test.
        const nameless = []
        for (const control of document.querySelectorAll('button, a[href], input:not([type="hidden"]), select')) {
          const box = control.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          const label = (control.getAttribute('aria-label')
            || control.getAttribute('title')
            || control.textContent
            || (control.labels && control.labels[0]?.textContent)
            || (control.getAttribute('aria-labelledby')
              ? document.getElementById(control.getAttribute('aria-labelledby'))?.textContent
              : '')
            || '').trim()
          if (label === '') {
            nameless.push(`${control.tagName.toLowerCase()}.${(typeof control.className === 'string' ? control.className : '').slice(0, 40)}`)
          }
        }

        // Every control a person is expected to press must be on screen.
        const unreachable = []
        for (const control of document.querySelectorAll('button, a[href], input, select')) {
          const box = control.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          if (box.left < -4 || box.right > root.clientWidth + 4) {
            let scrollable = false
            for (let parent = control.parentElement; parent; parent = parent.parentElement) {
              const overflow = getComputedStyle(parent).overflowX
              if (overflow === 'auto' || overflow === 'scroll') { scrollable = true; break }
            }
            if (scrollable) continue
            unreachable.push((control.getAttribute('aria-label') || control.textContent || control.tagName).trim().slice(0, 60))
          }
        }
        const main = document.querySelector('main')
        // `scrollWidth` on the root is inflated by things a person never sees
        // (a sticky cell inside a scroller is enough). What matters is whether
        // the window can actually be scrolled sideways, so that is what is
        // measured: try to, and see where it ends up.
        const before = window.scrollX
        window.scrollTo(9999, window.scrollY)
        const reached = window.scrollX
        window.scrollTo(before, window.scrollY)

        return {
          mainScroll: main ? `${main.scrollWidth}/${main.clientWidth}` : '',
          horizontalScroll: reached,
          nameless: [...new Set(nameless)].slice(0, 6),
          documentWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          offenders: offenders.sort((a, b) => b.right - a.right).slice(0, 6),
          unreachable: [...new Set(unreachable)].slice(0, 6),
        }
      }, Boolean(process.env['PORTTA_VIEWPORT_DEBUG']))

      const label = `${viewport.name} · ${target.name}`
      const scrolls = measured.horizontalScroll > 1
      if (scrolls) {
        problems.push(`${label}: the page scrolls sideways by ${measured.horizontalScroll}px` +
          (measured.offenders.length > 0 ? `\n    ${measured.offenders.map((o) => `${o.tag}.${o.className}`).join('\n    ')}` : ''))
      }
      if (measured.unreachable.length > 0) {
        problems.push(`${label}: controls off screen — ${measured.unreachable.join(', ')}`)
      }
      // Only worth reporting once: an unnamed control is unnamed at every width.
      if (measured.nameless.length > 0 && viewport === VIEWPORTS[0]) {
        problems.push(`${target.name}: controls with no accessible name — ${measured.nameless.join(', ')}`)
      }
      if (SHOTS) await page.screenshot({ path: join(OUT, `${viewport.name}-${target.name}.png`), fullPage: false })
      const failed = scrolls || measured.unreachable.length > 0 || (measured.nameless.length > 0 && viewport === VIEWPORTS[0])
      process.stdout.write(`${failed ? '✗' : '✓'} ${label}\n`)
    }
    await context.close()
  }
  await browser.close()
} finally {
  harness.kill('SIGTERM')
  stopPostgres()
}

if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} layout problems:\n`)
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
  process.exit(1)
}
process.stdout.write('\nevery viewport fits\n')
