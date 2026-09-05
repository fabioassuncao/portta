#!/usr/bin/env node
// Waits for the build the other harness is running.
//
// Playwright starts both web servers at once, and only one of them should run
// `next build` — two builds writing `.next` at the same time is a race with a
// corrupt output at the end of it. This one waits for the artefact instead.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const artefact = join(root, 'dist/server.mjs')
const deadline = Date.now() + 150_000

while (!existsSync(artefact) && Date.now() < deadline) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
}

if (!existsSync(artefact)) {
  process.stderr.write(`${artefact} never appeared; the panel build did not finish\n`)
  process.exit(1)
}

// The file exists as soon as esbuild opens it, so give the write a moment to
// land rather than starting Node on a half-written bundle.
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500)
