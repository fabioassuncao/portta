import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { docsBundle } from '@/lib/docs/bundle'
import { DocsToc } from '@/components/docs/docs-shell'
import { Prose } from '@/components/docs/prose'

// The corpus ships with the image and does not change while the panel runs, so
// every page is rendered once at build time and served as a file after that.
export const dynamic = 'force-static'

interface Params {
  slug?: string[]
}

function slugOf(params: Params): string {
  return params.slug?.join('/') || 'overview'
}

export function generateStaticParams(): Params[] {
  // The bare `/docs` is the overview, so it is generated as the empty path too.
  return [{ slug: [] }, ...docsBundle().order.map((slug) => ({ slug: slug.split('/') }))]
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const page = docsBundle().pages[slugOf(await params)]
  return { title: page ? `${page.title} · Documentation` : 'Documentation' }
}

export default async function DocPage({ params }: { params: Promise<Params> }) {
  const slug = slugOf(await params)
  const { pages, order, sections } = docsBundle()
  const page = pages[slug]
  if (!page) notFound()

  const position = order.indexOf(slug)
  const previous = position > 0 ? pages[order[position - 1]!] : undefined
  const next = position >= 0 && position < order.length - 1 ? pages[order[position + 1]!] : undefined
  const section = sections.find((entry) => entry.pages.some((item) => item.slug === slug))?.title ?? ''

  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1">
        {section ? <p className="text-sm text-muted">{section}</p> : null}
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{page.title}</h1>
        <Prose html={page.html} slug={slug} />
        <footer className="mt-12 border-t border-line pt-6 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            {previous ? (
              <Link
                href={`/docs/${previous.slug}`}
                className="group rounded-lg border border-line px-4 py-3 hover:border-accent/40 hover:text-accent"
              >
                <span className="block text-xs text-subtle">Previous</span>
                <span className="mt-0.5 block font-medium">← {previous.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                href={`/docs/${next.slug}`}
                className="group rounded-lg border border-line px-4 py-3 text-right hover:border-accent/40 hover:text-accent sm:col-start-2"
              >
                <span className="block text-xs text-subtle">Next</span>
                <span className="mt-0.5 block font-medium">{next.title} →</span>
              </Link>
            ) : null}
          </div>
          <p className="mt-5 text-xs text-subtle">
            Served from this panel’s image.{' '}
            <a
              className="underline hover:text-accent"
              href={`https://github.com/fabioassuncao/portta/blob/main/${page.source}`}
              target="_blank"
              rel="noreferrer"
            >
              {page.source} on GitHub <ExternalLink className="inline size-3" aria-hidden />
            </a>
          </p>
        </footer>
      </article>
      <DocsToc headings={page.headings} />
    </div>
  )
}
