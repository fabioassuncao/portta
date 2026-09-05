'use client'

// The six tabs of a Project, and which one the URL is on.
//
// A tab is a route, so the count beside each label comes from what the server
// already read for this render rather than from a query the tab bar starts.

import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Tabs } from '@/components/ui/tabs'

const TABS = ['overview', 'tasks', 'repositories', 'environments', 'activity', 'settings'] as const
export type ProjectTab = (typeof TABS)[number]

/** `/projects/shop/tasks/42` is still the tasks tab. */
export function tabFromPath(pathname: string, slug: string): ProjectTab {
  const base = `/projects/${encodeURIComponent(slug)}`
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, '') : ''
  const first = rest.split('/')[0] ?? ''
  return (TABS as readonly string[]).includes(first) ? (first as ProjectTab) : 'overview'
}

export function ProjectTabs({
  slug,
  name,
  repositories,
  environments,
}: {
  slug: string
  name: string
  repositories: number
  environments: number
}) {
  const { t } = useTranslation('projects')
  const pathname = usePathname()
  const base = `/projects/${encodeURIComponent(slug)}`
  return (
    <Tabs
      label={t('tabs.label', { name })}
      active={tabFromPath(pathname, slug)}
      tabs={[
        { id: 'overview', label: t('tabs.overview'), href: base },
        { id: 'tasks', label: t('tabs.tasks'), href: `${base}/tasks` },
        { id: 'repositories', label: t('tabs.repositories', { count: repositories }), href: `${base}/repositories` },
        { id: 'environments', label: t('tabs.environments', { count: environments }), href: `${base}/environments` },
        { id: 'activity', label: t('tabs.activity'), href: `${base}/activity` },
        { id: 'settings', label: t('tabs.settings'), href: `${base}/settings` },
      ]}
    />
  )
}
