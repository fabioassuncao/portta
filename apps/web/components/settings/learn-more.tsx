'use client'

import { useTranslation } from 'react-i18next'
import { docsHref } from 'portta-contracts'
import { DocText } from '../doc-text.tsx'

const GROUP_DOCS: Record<string, string> = {
  Projects: 'docs/adr/0031-projects-home-and-project.md',
  'Project domain': 'docs/addresses-and-access.md#project-addresses',
  'Project access': 'docs/addresses-and-access.md#project-access',
  TLS: 'docs/addresses-and-access.md#tls',
  DNS: 'docs/addresses-and-access.md#dns',
  Panel: 'docs/addresses-and-access.md#the-panel',
  Traefik: 'docs/addresses-and-access.md#traefik',
}

export function groupDocs(name: string): string | undefined {
  return GROUP_DOCS[name]
}

export function LearnMore({ citation }: { citation: string }) {
  const { t } = useTranslation('settings')
  return (
    <a
      href={docsHref(citation)}
      target="_blank"
      rel="noreferrer"
      className="text-xs text-accent underline underline-offset-2 hover:text-accent"
    >
      {t('learnMore')}
    </a>
  )
}

export function GroupIntro({ name }: { name: string }) {
  const { t } = useTranslation('settings')
  const docs = GROUP_DOCS[name]
  const description = t(`groupIntro.${name}`, { defaultValue: '' })
  if (!description && !docs) return null
  return (
    <span className="text-xs text-subtle">
      {description ? <DocText>{description}</DocText> : null}
      {description && docs ? ' ' : null}
      {docs ? <LearnMore citation={docs} /> : null}
    </span>
  )
}
