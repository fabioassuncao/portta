'use client'

import { useEffect, useRef } from 'react'
import { useDarkTheme } from '@/lib/theme'
import { renderMermaid } from '@/lib/docs/mermaid'

/**
 * A rendered documentation page, with its Mermaid fences drawn.
 *
 * The HTML is the project's own documentation, rendered on the server from the
 * repository's Markdown. A table (and the tags a table needs) is passed through
 * after an allowlist; a raw `<script>` or an event handler is escaped, so
 * nothing a user typed reaches here at all. If this component ever renders
 * something a user supplied, it needs a sanitiser first.
 *
 * Mermaid runs in the browser because it measures text to lay a diagram out,
 * and there is nothing to measure on the server.
 */
export function Prose({ html, slug }: { html: string; slug: string }) {
  const container = useRef<HTMLDivElement>(null)
  const dark = useDarkTheme()

  useEffect(() => {
    const element = container.current
    if (!element) return
    let cancelled = false
    void renderMermaid(element, dark, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [slug, dark])

  return <div ref={container} className="prose mt-6" dangerouslySetInnerHTML={{ __html: html }} />
}
