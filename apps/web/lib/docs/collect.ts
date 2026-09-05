// The documentation, turned into a bundle at build time.
//
// The source of truth does not move: `docs/*.md` stays ordinary Markdown,
// readable on GitHub, with no front matter and no second copy. This reads it,
// renders it, and emits one JSON document the panel image carries — so the
// whole site is offline by construction, with no CDN, no font host and no
// runtime Markdown dependency in the panel's production tree.
//
// The navigation comes from the section headings of `docs/README.md`, which is
// the index the project already maintains by hand. Deriving it from the
// filesystem would invent an order nobody chose, and would quietly drop a page
// the index deliberately leaves out.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import MarkdownIt from 'markdown-it'
import { slugFor } from 'portta-contracts'

export { slugFor } from 'portta-contracts'

export interface DocHeading {
  id: string
  text: string
  level: number
}

export interface DocPage {
  /** `install`, `adr/0007-tailscale-sidecar`, `overview`, `changelog`. */
  slug: string
  title: string
  html: string
  headings: DocHeading[]
  /** Lower-cased text, for the client-side search. */
  search: string
  /** Where this page came from, so a reader can open it on GitHub. */
  source: string
}

export interface DocSection {
  title: string
  pages: Array<{ slug: string; title: string; summary: string }>
}

export interface DocsBundle {
  sections: DocSection[]
  pages: Record<string, DocPage>
  /** Every page in navigation order, for previous/next. */
  order: string[]
  generatedAt: string
}

const GITHUB_BLOB = 'https://github.com/fabioassuncao/portta/blob/main'

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Rewrite one link.
 *
 * A relative link into the documentation set becomes a route in the site; a
 * link that leaves it becomes an absolute GitHub URL and is marked external,
 * because the panel ships the documentation and not the repository. An anchor
 * is preserved either way.
 */
export function rewriteLink(href: string, fromRepoPath: string, known: Set<string>): { href: string; external: boolean } {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return { href, external: true }
  if (href.startsWith('#')) return { href, external: false }

  const [rawPath = '', anchor] = href.split('#')
  const target = relative('.', resolve(dirname(fromRepoPath), rawPath)).replace(/\\/g, '/')
  const suffix = anchor ? `#${anchor}` : ''

  if (target.endsWith('.md')) {
    const slug = slugFor(target)
    // The index is the sidebar, so a link to it goes home.
    if (slug === 'README') return { href: `/docs${suffix}`, external: false }
    if (known.has(slug)) return { href: `/docs/${slug}${suffix}`, external: false }
  }
  // A directory index, e.g. `adr/`.
  if (rawPath.endsWith('/')) {
    const slug = slugFor(`${target}/README.md`)
    if (known.has(slug)) return { href: `/docs/${slug}${suffix}`, external: false }
  }
  return { href: `${GITHUB_BLOB}/${target}${suffix}`, external: true }
}

const HTML_TAGS = new Set([
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'a', 'img', 'br', 'sub', 'sup', 'b', 'strong', 'em', 'i',
])
const HTML_ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan'])

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function rewriteHtmlUrl(url: string, fromRepoPath: string, known: Set<string>, kind: 'href' | 'src'): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return url
  if (url.startsWith('#')) return url
  const [rawPath = '', anchor] = url.split('#')
  const target = relative('.', resolve(dirname(fromRepoPath), rawPath)).replace(/\\/g, '/')
  const suffix = anchor ? `#${anchor}` : ''
  if (target.startsWith('docs/images/')) return `/docs/images/${basename(target)}${suffix}`
  if (kind === 'href') return rewriteLink(url, fromRepoPath, known).href
  return `${GITHUB_BLOB}/${target}${suffix}`
}

/**
 * A raw HTML block from the Markdown: keep a table (and the tags a table
 * needs), rewrite its images like the rest of the corpus, and escape
 * anything else. The site renders this with dangerouslySetInnerHTML.
 */
export function rewriteHtmlBlock(html: string, fromRepoPath: string, known: Set<string>): string {
  const tags = [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)\/?>/g)]
  if (tags.length === 0) return escapeHtml(html)
  for (const match of tags) {
    const name = match[1]!.toLowerCase()
    const rawAttrs = match[2] ?? ''
    if (!HTML_TAGS.has(name)) return escapeHtml(html)
    const attrs = [...rawAttrs.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g)]
    for (const attr of attrs) {
      const key = attr[1]!.toLowerCase()
      const value = attr[2] ?? attr[3] ?? attr[4] ?? ''
      if (key.startsWith('on') || !HTML_ATTRS.has(key)) return escapeHtml(html)
      if (/^\s*(javascript|data):/i.test(value)) return escapeHtml(html)
    }
  }

  return html.replace(/\s(href|src)=("([^"]*)"|'([^']*)')/gi, (_all, attr: string, _quoted: string, double?: string, single?: string) => {
    const value = double ?? single ?? ''
    const rewritten = rewriteHtmlUrl(value, fromRepoPath, known, attr.toLowerCase() === 'href' ? 'href' : 'src')
    return ` ${attr.toLowerCase()}="${rewritten}"`
  })
}

function markdownFiles(root: string): string[] {
  const found: string[] = ['README.md', 'CHANGELOG.md']
  const walk = (directory: string): void => {
    for (const entry of readdirSync(join(root, directory)).sort()) {
      const repoPath = `${directory}/${entry}`
      if (statSync(join(root, repoPath)).isDirectory()) {
        // Historical build briefs are deliberately not product documentation.
        if (entry !== 'prompts') walk(repoPath)
      } else if (entry.endsWith('.md')) {
        found.push(repoPath)
      }
    }
  }
  walk('docs')
  return found.filter((path) => {
    try { return statSync(join(root, path)).isFile() } catch { return false }
  })
}

/** The first `# heading`, or the filename. A page with no title is a defect. */
function titleOf(markdown: string, repoPath: string): string {
  const match = /^#\s+(.+)$/m.exec(markdown)
  return match ? match[1]!.trim() : basename(repoPath, '.md')
}

/**
 * The navigation, read out of `docs/README.md`.
 *
 * Its `## Section` headings become sections and its bullet links become pages,
 * in the order they appear. Anything under `docs/` the index does not name is
 * appended under *Everything else*, so a page cannot be invisible — but the
 * order the project chose still wins.
 */
export function sectionsFrom(indexMarkdown: string, known: Map<string, string>): DocSection[] {
  const sections: DocSection[] = []
  let current: DocSection | null = null
  // Both are placed by the caller, which brackets the set with the front door
  // and the history; listing either here as well would duplicate it.
  const placed = new Set<string>(['overview', 'changelog'])

  for (const line of indexMarkdown.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      current = { title: heading[1]!.trim(), pages: [] }
      sections.push(current)
      continue
    }
    const bullet = /^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:—|--|-)?\s*(.*)$/.exec(line)
    if (!bullet || !current) continue
    const [, label = '', href = '', summary = ''] = bullet
    const target = href.split('#')[0] ?? ''
    const slug = target.endsWith('/') ? slugFor(`docs/${target}README.md`) : slugFor(`docs/${target}`)
    if (!known.has(slug) || placed.has(slug)) continue
    placed.add(slug)
    current.pages.push({ slug, title: label.trim(), summary: summary.trim() })
  }

  // The ADRs are linked from the index as a directory, so they would otherwise
  // all land in the leftovers. They are a set with an order of their own --
  // the number -- and they read as one.
  const records = [...known.keys()].filter((slug) => slug.startsWith('adr/') && !placed.has(slug)).sort()
  if (records.length > 0) {
    for (const slug of records) placed.add(slug)
    sections.push({
      title: 'Architecture decisions',
      pages: records.map((slug) => ({ slug, title: known.get(slug) ?? slug, summary: '' })),
    })
  }

  const leftovers = [...known.keys()].filter((slug) => !placed.has(slug) && slug !== 'README').sort()
  if (leftovers.length > 0) {
    sections.push({
      title: 'Everything else',
      pages: leftovers.map((slug) => ({ slug, title: known.get(slug) ?? slug, summary: '' })),
    })
  }
  return sections.filter((section) => section.pages.length > 0)
}

/**
 * Whether a relative link aimed at the documentation set and missed.
 *
 * `../templates/project/PORTTA.md` is not broken: it is a real file the
 * documentation deliberately links out to. `./instal.md` is.
 */
export function isMissingDocPage(href: string, fromRepoPath: string, known: Set<string>): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return false
  const [rawPath = ''] = href.split('#')
  if (!rawPath.endsWith('.md')) return false
  const target = relative('.', resolve(dirname(fromRepoPath), rawPath)).replace(/\\/g, '/')
  const insideTheSet = target.startsWith('docs/') || target === 'README.md' || target === 'CHANGELOG.md'
  return insideTheSet && !known.has(slugFor(target))
}

export class BrokenLink extends Error {}

export function collectDocs(root: string): DocsBundle {
  const files = markdownFiles(root)
  const sources = new Map(files.map((path) => [path, readFileSync(join(root, path), 'utf8')]))
  const titles = new Map([...sources].map(([path, text]) => [slugFor(path), titleOf(text, path)]))
  titles.set('overview', 'Portta')
  const known = new Set(titles.keys())

  const md = new MarkdownIt({ html: true, linkify: false, typographer: false })

  const pages: Record<string, DocPage> = {}
  const broken: string[] = []

  for (const [repoPath, text] of sources) {
    const slug = slugFor(repoPath)
    // `docs/README.md` is the index, and the sidebar *is* the index: rendering
    // it as a page would put a second copy of the navigation inside the
    // navigation. Links to it resolve to `/docs` instead.
    if (slug === 'README') continue
    const headings: DocHeading[] = []
    const tokens = md.parse(text, {})

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!
      if (token.type === 'heading_open') {
        const inline = tokens[index + 1]
        const label = (inline?.content ?? '').replace(/[`*_]/g, '')
        const id = headingId(label)
        token.attrSet('id', id)
        headings.push({ id, text: label, level: Number(token.tag.slice(1)) })
      }
      if (token.type === 'inline' && token.children) {
        for (const child of token.children) {
          if (child.type !== 'link_open') continue
          const href = child.attrGet('href') ?? ''
          const { href: rewritten, external } = rewriteLink(href, repoPath, known)
          // A link that *meant* to reach a documentation page and named one
          // that does not exist is a typo, and the build is the right place to
          // notice it. A link that leaves the set on purpose — the templates,
          // the compose examples — is not broken, and becomes a GitHub URL.
          if (external && isMissingDocPage(href, repoPath, known)) broken.push(`${repoPath}: ${href}`)
          child.attrSet('href', rewritten)
          if (external) {
            child.attrSet('target', '_blank')
            child.attrSet('rel', 'noreferrer')
            child.attrSet('data-external', 'true')
          }
        }
      }
      // Screenshots ship with the bundle; anything else keeps its own address.
      if (token.type === 'inline' && token.children) {
        for (const child of token.children) {
          if (child.type !== 'image') continue
          const src = child.attrGet('src') ?? ''
          if (/^[a-z]+:/i.test(src)) continue
          const target = relative('.', resolve(dirname(repoPath), src)).replace(/\\/g, '/')
          child.attrSet('src', target.startsWith('docs/images/') ? `/docs/images/${basename(target)}` : `${GITHUB_BLOB}/${target}`)
          child.attrSet('loading', 'lazy')
        }
      }
      if (token.type === 'html_block' || token.type === 'html_inline') {
        token.content = rewriteHtmlBlock(token.content, repoPath, known)
      }
    }

    pages[slug] = {
      slug,
      title: titles.get(slug) ?? slug,
      html: md.renderer.render(tokens, md.options, {}),
      headings: headings.filter((heading) => heading.level >= 2 && heading.level <= 3),
      search: text.replace(/[#>`*_[\]()]/g, ' ').replace(/\s+/g, ' ').toLowerCase().slice(0, 20_000),
      source: repoPath,
    }
  }

  if (broken.length > 0) {
    throw new BrokenLink(`the documentation has ${broken.length} broken internal link(s):\n  ${broken.join('\n  ')}`)
  }

  const sections = sectionsFrom(sources.get('docs/README.md') ?? '', titles)
  // The overview and the changelog bracket the set: one is the front door and
  // one is the history, and neither belongs inside a topic section.
  sections.unshift({ title: 'Portta', pages: [{ slug: 'overview', title: 'Overview', summary: 'What Portta is, and the shortest path to a running gateway.' }] })
  sections.push({ title: 'History', pages: [{ slug: 'changelog', title: 'Changelog', summary: 'Every released version.' }] })

  return {
    sections,
    pages,
    order: sections.flatMap((section) => section.pages.map((page) => page.slug)),
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  }
}
