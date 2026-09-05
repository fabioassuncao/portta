'use client'

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/** Joins the known parts with a middle dot and appends the panel name. */
export function useDocumentTitle(...parts: Array<string | null | undefined>): void {
  const { t } = useTranslation('nav')
  const suffix = t('documentTitle.suffix')
  const title = [
    ...parts.filter((part): part is string => Boolean(part?.trim())).map((part) => part.trim()),
    suffix,
  ].join(' · ')

  useEffect(() => {
    document.title = title
  }, [title])
}
