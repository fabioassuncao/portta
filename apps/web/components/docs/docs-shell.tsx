'use client'

// The documentation's own frame: a search box, a section list, and the page.
//
// The search index is the pages' titles and section names — enough to find a
// page by name without shipping the body text of seventy of them to the
// browser. Full-text search over the corpus is what the panel's own command
// palette is for once it reaches the docs.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, ChevronRight, List, Moon, PanelLeft, Search, Sun } from 'lucide-react'
import type { DocHeading, DocSection } from '@/lib/docs/collect'
import { useDarkTheme, useThemeChoice } from '@/lib/theme'

const DocsScrollContext = createContext<RefObject<HTMLElement | null>>({ current: null })

export function useDocsScrollRoot(): RefObject<HTMLElement | null> {
  return useContext(DocsScrollContext)
}

function useActiveHeading(root: RefObject<HTMLElement | null>, ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null)
  const key = ids.join('\0')

  useEffect(() => {
    const container = root.current
    if (!container || ids.length === 0) {
      setActive(ids[0] ?? null)
      return
    }
    setActive(ids[0] ?? null)
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        const first = ids.find((id) => visible.has(id))
        if (first) setActive(first)
      },
      { root: container, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    )
    for (const id of ids) {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [root, key, ids])

  return active
}

export function DocsToc({ headings }: { headings: DocHeading[] }) {
  const main = useDocsScrollRoot()
  const ids = useMemo(() => headings.map((heading) => heading.id), [headings])
  const active = useActiveHeading(main, ids)

  if (headings.length < 2) return null

  return (
    <aside className="sticky top-0 hidden h-fit max-h-[calc(100dvh-6rem)] w-64 shrink-0 self-start overflow-y-auto scroll-thin xl:block">
      <nav className="py-1 text-sm">
        <p className="mb-3 flex items-center gap-2 text-[13px] font-medium text-ink">
          <List className="size-3.5 text-subtle" aria-hidden />
          On this page
        </p>
        <ul className="space-y-1">
          {headings.map((heading) => (
            <li key={heading.id} style={{ paddingLeft: heading.level === 3 ? '0.75rem' : 0 }}>
              <a
                href={`#${heading.id}`}
                className={`block truncate ${
                  active === heading.id ? 'font-medium text-accent' : 'text-muted hover:text-accent'
                }`}
                title={heading.text}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}

interface Hit {
  slug: string
  title: string
  section: string
}

function useSearchShortcut(input: RefObject<HTMLInputElement | null>): string {
  const [label, setLabel] = useState('Ctrl K')
  useEffect(() => {
    setLabel(/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K')
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'k') return
      event.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [input])
  return label
}

export function DocsShell({ sections, children }: { sections: DocSection[]; children: ReactNode }) {
  const pathname = usePathname()
  const slug = pathname.replace(/^\/docs\/?/, '') || 'overview'
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const main = useRef<HTMLElement>(null)
  const shortcut = useSearchShortcut(input)
  const { setTheme } = useThemeChoice()
  const dark = useDarkTheme()

  const index = useMemo(
    () => sections.flatMap((section) => section.pages.map((page) => ({ ...page, section: section.title }))),
    [sections],
  )

  // Substring, not fuzzy: the corpus is seventy pages and the reader knows
  // roughly what the page is called. A ranking that put a partial match above
  // an exact title would be worse than no ranking at all.
  const hits: Hit[] = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length < 2) return []
    return index
      .filter((page) => page.title.toLowerCase().includes(needle) || page.slug.includes(needle))
      .slice(0, 20)
      .map((page) => ({ slug: page.slug, title: page.title, section: page.section }))
  }, [index, query])

  useEffect(() => {
    setQuery('')
    setOpen(false)
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
    if (!hash) {
      main.current?.scrollTo({ top: 0 })
      return
    }
    const timer = window.setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ block: 'start' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [pathname])

  const entry = (href: string, title: string, current: boolean, summary?: string) => (
    <li key={href}>
      <Link
        href={href}
        aria-current={current ? 'page' : undefined}
        title={summary ?? title}
        className={`block truncate rounded-lg px-2 py-1.5 ${
          current ? 'bg-accent/12 font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink'
        }`}
      >
        {title}
      </Link>
    </li>
  )

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-ink">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 shrink-0 items-center gap-2 sm:w-48">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
            aria-label="Toggle the navigation"
          >
            <PanelLeft className="size-4" aria-hidden />
          </button>
          <Link href="/docs" className="flex items-center gap-2 font-semibold">
            <BookOpen className="size-4 text-accent" aria-hidden />
            Portta docs
          </Link>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the documentation"
            aria-label="Search the documentation"
            className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-14 text-sm outline-none focus:border-accent"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 py-0.5 text-[10px] text-subtle sm:inline">
            {shortcut}
          </kbd>
          {hits.length > 0 ? (
            <ul className="absolute z-20 mt-1 max-h-96 w-full overflow-y-auto scroll-thin rounded-md border border-line bg-surface shadow-lg">
              {hits.map((hit) => (
                <li key={hit.slug}>
                  <Link href={`/docs/${hit.slug}`} className="block px-3 py-2 hover:bg-surface-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {hit.title}
                      <ChevronRight className="size-3 text-subtle" aria-hidden />
                      <span className="text-xs font-normal text-subtle">{hit.section}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:w-48 sm:justify-end">
          <Link href="/" className="hidden rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink sm:block">
            Back to the panel
          </Link>
          <button
            type="button"
            onClick={() => setTheme(dark ? 'light' : 'dark')}
            className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
            aria-label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
          >
            {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          className={`w-64 shrink-0 overflow-hidden border-r border-line bg-surface ${open ? 'absolute inset-y-0 left-0 top-12 z-10' : 'hidden'} lg:static lg:block lg:min-h-0`}
        >
          <nav className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto scroll-thin px-4 py-6 text-sm">
            {sections.map((section) => (
              <div key={section.title}>
                <p className="mb-1.5 px-2 text-[13px] font-medium text-ink">{section.title}</p>
                <ul>
                  {section.pages.map((page) =>
                    entry(`/docs/${page.slug}`, page.title, page.slug === slug, page.summary || undefined),
                  )}
                </ul>
              </div>
            ))}
            <div>
              <p className="mb-1.5 px-2 text-[13px] font-medium text-ink">Reference</p>
              <ul>{entry('/docs/api', 'API reference', slug === 'api')}</ul>
            </div>
          </nav>
        </div>
        <DocsScrollContext.Provider value={main}>
          <main
            ref={main}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto scroll-thin px-6 py-8 lg:px-10 lg:py-10"
          >
            {children}
          </main>
        </DocsScrollContext.Provider>
      </div>
    </div>
  )
}
