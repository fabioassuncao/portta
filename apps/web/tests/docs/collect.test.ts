// The documentation corpus, and what the build makes of it.
//
// `collect.ts` belongs to the panel, not to the API: it runs at build time and
// turns the repository's Markdown into the bundle the docs surface serves. The
// routes that serve that bundle are tested in packages/server/tests/docs.test.ts.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { collectDocs, headingId, isMissingDocPage, rewriteHtmlBlock, rewriteLink, sectionsFrom, slugFor } from '@/lib/docs/collect'

const REPOSITORY_ROOT = new URL('../../../../', import.meta.url).pathname

describe('slugs and headings', () => {
  it('maps a repository path to a route', () => {
    expect(slugFor('docs/install.md')).toBe('install')
    expect(slugFor('docs/adr/0007-tailscale-sidecar.md')).toBe('adr/0007-tailscale-sidecar')
    expect(slugFor('README.md')).toBe('overview')
    expect(slugFor('CHANGELOG.md')).toBe('changelog')
    expect(slugFor('docs/adr/README.md')).toBe('adr')
  })

  it('makes an anchor a reader can link to', () => {
    expect(headingId('Where things go')).toBe('where-things-go')
    expect(headingId('`portta up` and friends')).toBe('portta-up-and-friends')
    expect(headingId('DNS & TLS')).toBe('dns-tls')
  })
})

describe('link rewriting', () => {
  const known = new Set(['install', 'adr/0007-tailscale-sidecar', 'overview', 'networking'])

  it('turns a relative documentation link into a route, keeping the anchor', () => {
    expect(rewriteLink('install.md', 'docs/README.md', known)).toEqual({ href: '/docs/install', external: false })
    expect(rewriteLink('networking.md#ports', 'docs/install.md', known))
      .toEqual({ href: '/docs/networking#ports', external: false })
    expect(rewriteLink('adr/0007-tailscale-sidecar.md', 'docs/architecture.md', known))
      .toEqual({ href: '/docs/adr/0007-tailscale-sidecar', external: false })
    expect(rewriteLink('../install.md', 'docs/adr/0007-x.md', known))
      .toEqual({ href: '/docs/install', external: false })
  })

  // The panel ships the documentation, not the repository, so a link out of the
  // set has to reach GitHub or it reaches nothing.
  it('sends a link that leaves the set to GitHub, and marks it external', () => {
    const out = rewriteLink('../templates/project/PORTTA.md', 'docs/adopting-projects.md', known)
    expect(out.external).toBe(true)
    expect(out.href).toBe('https://github.com/fabioassuncao/portta/blob/main/templates/project/PORTTA.md')
  })

  it('leaves an absolute URL and a bare anchor alone', () => {
    expect(rewriteLink('https://example.com', 'docs/install.md', known)).toEqual({ href: 'https://example.com', external: true })
    expect(rewriteLink('#where-things-go', 'docs/install.md', known)).toEqual({ href: '#where-things-go', external: false })
  })
})

describe('the broken-link check', () => {
  const known = new Set(['install', 'networking'])

  // The build is the right place to notice a typo in a link between two
  // documentation pages, which is the link checker this repository lacked.
  it('catches a documentation link that names a page which does not exist', () => {
    expect(isMissingDocPage('./instal.md', 'docs/README.md', known)).toBe(true)
    expect(isMissingDocPage('networking.md#ports', 'docs/install.md', known)).toBe(false)
  })

  // Not everything the documentation links to is documentation.
  it('does not call a deliberate link out of the set broken', () => {
    expect(isMissingDocPage('../templates/project/PORTTA.md', 'docs/adopting-projects.md', known)).toBe(false)
    expect(isMissingDocPage('https://example.com/x.md', 'docs/install.md', known)).toBe(false)
    expect(isMissingDocPage('#anchor', 'docs/install.md', known)).toBe(false)
  })
})

describe('the navigation', () => {
  it('is the order docs/README.md defines, not the filesystem order', () => {
    const index = [
      '# Documentation',
      '',
      '## Getting started',
      '- [Installing](install.md) — the installer',
      '- [Networking](networking.md) — ports',
      '',
      '## How it works',
      '- [Architecture](architecture.md) — components',
    ].join('\n')
    const known = new Map([['install', 'Installing and updating'], ['networking', 'Networking'], ['architecture', 'Architecture']])
    const sections = sectionsFrom(index, known)
    expect(sections.map((section) => section.title)).toEqual(['Getting started', 'How it works'])
    expect(sections[0]?.pages.map((page) => page.slug)).toEqual(['install', 'networking'])
    expect(sections[0]?.pages[0]?.summary).toBe('the installer')
  })

  // A page the index forgets must still be reachable, or it is invisible; but
  // the order the project chose still wins for everything it does name.
  it('appends a page the index does not name rather than losing it', () => {
    const sections = sectionsFrom('## Only\n- [Installing](install.md)', new Map([['install', 'Installing'], ['forgotten', 'Forgotten']]))
    expect(sections.at(-1)?.title).toBe('Everything else')
    expect(sections.at(-1)?.pages.map((page) => page.slug)).toEqual(['forgotten'])
  })
})

describe('the real corpus', () => {
  const bundle = collectDocs(REPOSITORY_ROOT)

  // The whole reason this is a build step: it throws on a broken link, so the
  // documentation cannot ship with one.
  it('collects every page without a broken internal link', () => {
    expect(Object.keys(bundle.pages).length).toBeGreaterThan(50)
  })

  it('places every page in the navigation exactly once', () => {
    expect(new Set(bundle.order).size).toBe(bundle.order.length)
    for (const slug of bundle.order) expect(bundle.pages[slug], slug).toBeDefined()
  })

  it('gives the ADRs a section of their own, in numerical order', () => {
    const records = bundle.sections.find((section) => section.title === 'Architecture decisions')
    expect(records?.pages.length).toBeGreaterThan(20)
    expect(records?.pages[0]?.slug).toBe('adr/0001-decoupled-infrastructure')
  })

  it('opens with the overview and closes with the changelog', () => {
    expect(bundle.order[0]).toBe('overview')
    expect(bundle.order.at(-1)).toBe('changelog')
  })

  it('rewrites the screenshots to the copies the image carries', () => {
    expect(bundle.pages['web-ui']?.html).toContain('/docs/images/panel-overview.png')
    expect(bundle.pages['web-ui']?.html).not.toContain('.github/images')
    expect(bundle.pages['web-ui']?.headings.length).toBeGreaterThan(2)
  })

  it('renders the overview screenshot table, with the bundled image paths', () => {
    const html = bundle.pages['overview']?.html ?? ''
    expect(html).toContain('<table>')
    expect(html).toContain('/docs/images/panel-overview.png')
    expect(html).not.toContain('.github/images')
    expect(html).not.toContain('&lt;table')
  })

  // A script or an event handler is escaped at collect time, so a raw tag in
  // a Markdown file never reaches dangerouslySetInnerHTML.
  it('anchors the addresses-and-access guide the settings pages link to', () => {
    const ids = (bundle.pages['addresses-and-access']?.headings ?? []).map((heading) => heading.id)
    for (const id of [
      'the-three-decisions',
      'project-addresses',
      'project-access',
      'public-access',
      'traefik',
      'tls',
      'the-panel',
      'custom-panel-domain',
      'vpn',
      'dns',
    ]) {
      expect(ids, id).toContain(id)
    }
  })

  it('never emits a script tag', () => {
    for (const page of Object.values(bundle.pages)) {
      expect(page.html.toLowerCase(), page.slug).not.toContain('<script')
    }
  })

  // The site is offline: every asset comes from the panel image. A link out to
  // GitHub is fine -- it is a link, marked external, that the reader chooses to
  // follow -- but an image loaded from a host is a request the page makes on
  // its own, and there must be none.
  it('loads every image from the image, never from a host', () => {
    const html = Object.values(bundle.pages).map((page) => page.html).join('')
    const remote = [...html.matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/g)].map((match) => match[1])
    expect(remote).toEqual([])
  })
})

describe('raw HTML in a page', () => {
  const known = new Set(['install'])

  it('keeps a table and rewrites a screenshot path', () => {
    const html = rewriteHtmlBlock(
      '<table><tr><td><img src="docs/images/x.png" alt="x"></td></tr></table>',
      'README.md',
      known,
    )
    expect(html).toContain('<table>')
    expect(html).toContain('src="/docs/images/x.png"')
    expect(html).not.toContain('.github/images')
  })

  it('escapes a script and a table with an event handler', () => {
    expect(rewriteHtmlBlock('<script>alert(1)</script>', 'README.md', known)).toContain('&lt;script')
    expect(rewriteHtmlBlock('<table onerror="alert(1)"><tr><td>x</td></tr></table>', 'README.md', known))
      .toContain('&lt;table')
  })
})

describe('the built bundle', () => {
  it('carries no absolute asset URL, so nothing is fetched from a CDN', () => {
    let html: string
    try {
      html = readFileSync(new URL('../../dist/docs/index.html', import.meta.url), 'utf8')
    } catch {
      return // not built in this checkout; the Docker build always builds it
    }
    expect(html).not.toMatch(/(?:src|href)=["']https?:\/\//)
  })
})
