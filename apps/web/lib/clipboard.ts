'use client'

import { useCallback, useRef, useState } from 'react'

/** Copying a URL or a connection string is the panel's most-used action. */
export function useCopy(): { copied: string | null; copy: (value: string, key?: string) => void } {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback((value: string, key?: string) => {
    const mark = () => {
      setCopied(key ?? value)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(null), 1400)
    }

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(value).then(mark, fallback)
      return
    }
    fallback()

    function fallback() {
      const area = document.createElement('textarea')
      area.value = value
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      try {
        document.execCommand('copy')
        mark()
      } finally {
        document.body.removeChild(area)
      }
    }
  }, [])

  return { copied, copy }
}
