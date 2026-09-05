'use client'

// What happened in this Project, newest first, with paging.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ActivityEvent } from 'portta-contracts'
import { useProjectActivity } from '@/lib/queries'
import { Card, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ActivityTimeline } from '@/components/entities/activity-timeline'
import { ErrorBox, Loading, Toolbar, ToolbarSearch, ToolbarSelect } from '@/components/shell-bits'

export function ActivityTab({ slug, initialEvents }: { slug: string; initialEvents: ActivityEvent[] }) {
  const { t } = useTranslation('activity')
  const [kind, setKind] = useState('')
  const [actor, setActor] = useState('')
  const [before, setBefore] = useState<string | null>(null)
  const [pages, setPages] = useState<string[]>([])
  const filters = { kind: kind || undefined, actor: actor || undefined, limit: '50', before: before ?? undefined }
  const activity = useProjectActivity(slug, filters)
  // The server read the first page for this render; the query owns it after.
  const events = activity.data?.events ?? initialEvents

  const reset = () => {
    setBefore(null)
    setPages([])
  }

  return (
    <Card>
      <CardHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Toolbar>
            <ToolbarSelect width="lg" value={kind} onChange={(event) => { setKind(event.target.value); reset() }} aria-label={t('kindFilter')}>
              <option value="">{t('anyKind')}</option>
              {['task', 'session', 'repository', 'environment', 'service', 'project'].map((entity) => (
                <option key={entity} value={entity}>{t(`entity.${entity}` as 'entity.task')}</option>
              ))}
            </ToolbarSelect>
            <ToolbarSearch className="w-40" value={actor} onChange={(event) => { setActor(event.target.value); reset() }} placeholder={t('actorFilter')} aria-label={t('actorFilter')} />
          </Toolbar>
        }
      />
      {activity.isPending && events.length === 0 ? (
        <Loading />
      ) : activity.error ? (
        <ErrorBox error={activity.error} />
      ) : (
        <>
          {pages.length > 0 ? (
            <div className="px-3 pt-2">
              <Button size="sm" onClick={() => { const previous = [...pages]; const last = previous.pop() ?? null; setPages(previous); setBefore(last) }}>{t('newer')}</Button>
            </div>
          ) : null}
          <ActivityTimeline
            events={events}
            showProject={false}
            onLoadMore={activity.data?.nextBefore ? () => { setPages([...pages, before ?? '']); setBefore(activity.data!.nextBefore) } : null}
          />
        </>
      )}
    </Card>
  )
}
