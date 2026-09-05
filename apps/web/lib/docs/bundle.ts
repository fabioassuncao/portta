import 'server-only'
import { resolve } from 'node:path'
import { collectDocs, type DocsBundle } from './collect.ts'

// The corpus, collected once per process.
//
// `collectDocs` walks `docs/**` and renders every page; doing that per request
// would read seventy files to answer one. The pages are static — they are the
// repository's own Markdown, baked into the image — so one read is one read.

let cached: DocsBundle | null = null

/**
 * The repository root, which is two levels above the panel.
 *
 * From the working directory rather than from `import.meta.url`: the bundler
 * reads `new URL(…, import.meta.url)` as an asset reference and tries to
 * resolve it at build time, and `docs/` is a directory of Markdown, not a
 * module. The panel always runs from `apps/web` — `npm run dev`, `next build`
 * and the image's `WORKDIR` all agree — so the working directory is the stable
 * anchor here.
 */
export function repositoryRoot(): string {
  return process.env['PORTTA_RUNTIME_DOCS_ROOT'] ?? resolve(process.cwd(), '..', '..')
}

export function docsBundle(): DocsBundle {
  cached ??= collectDocs(repositoryRoot())
  return cached
}

export type { DocPage, DocSection, DocsBundle } from './collect.ts'
