// Paths the documentation site understands, shared by the build-time collector
// and the panel UI. No filesystem: the UI bundle cannot import collect.ts.

/** `docs/install.md` -> `install`; `docs/adr/0007-x.md` -> `adr/0007-x`. */
export function slugFor(repoPath: string): string {
  if (repoPath === 'README.md') return 'overview'
  if (repoPath === 'CHANGELOG.md') return 'changelog'
  return repoPath.replace(/^docs\//, '').replace(/\.md$/, '').replace(/\/README$/, '')
}

/**
 * A citation in panel copy (`docs/github.md`, `/docs/api`,
 * `docs/addresses-and-access.md#the-panel`) becomes the URL the documentation
 * site actually serves.
 */
export function docsHref(citation: string): string {
  const [path = '', anchor] = citation.split('#')
  const suffix = anchor ? `#${anchor}` : ''
  if (path === '/docs' || path === '/docs/') return `/docs/${suffix}`
  if (path === '/docs/api') return `/docs/api${suffix}`
  return `/docs/${slugFor(path)}${suffix}`
}

/** Longest-first so `/docs/api` is not eaten by `/docs`. Anchors stay on the citation. */
export const DOC_REF = /docs\/[\w./-]+\.md(?:#[\w-]+)?|\/docs\/api(?:#[\w-]+)?\b|\/docs\/?/g

export function splitDocRefs(text: string): Array<{ text: string; href: string | null }> {
  const parts: Array<{ text: string; href: string | null }> = []
  let last = 0
  for (const match of text.matchAll(DOC_REF)) {
    const start = match.index ?? 0
    if (start > last) parts.push({ text: text.slice(last, start), href: null })
    parts.push({ text: match[0], href: docsHref(match[0]) })
    last = start + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), href: null })
  if (parts.length === 0) parts.push({ text, href: null })
  return parts
}
