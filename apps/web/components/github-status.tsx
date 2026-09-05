'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { api } from '../lib/api/index.ts'
import { keys, useGitHub } from '../lib/queries/index.ts'
import { Badge, StatusIndicator } from './ui/badge.tsx'
import { Mono } from './copy.tsx'
import { Button } from './ui/button.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'
import { Empty, ErrorBox, KeyValue, Loading } from './shell-bits.tsx'
import { useFormat } from '../lib/use-format.ts'

export function GitHubStatusCard() {
  const { t } = useTranslation('gateway', { keyPrefix: 'settings.github' })
  const { relativeTime } = useFormat()
  const queryClient = useQueryClient()
  const query = useGitHub()

  const sync = useMutation({
    mutationFn: () => api.syncGitHub(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.github() }),
  })

  if (query.isPending) return <Loading label={t('reading')} />
  if (query.error) return <ErrorBox error={query.error} />

  const view = query.data!
  const status = view.status

  if (!status.configured) {
    return (
      <Card>
        <CardHeader title={t('title')} description={t('description')} />
        <Empty title={t('notConfigured')} hint={t('notConfiguredHint')} />
      </Card>
    )
  }

  const budget = status.rateLimit

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>{t('title')}</span>
            {status.available ? (
              <StatusIndicator tone="ok">{t('connected', { defaultValue: 'connected' })}</StatusIndicator>
            ) : (
              <StatusIndicator tone="warn">{t('unreachable', { defaultValue: 'unreachable' })}</StatusIndicator>
            )}
          </span>
        }
        description={status.available ? `App ${status.appId} · ${status.apiUrl}` : (status.reason ?? undefined)}
        actions={
          <Button size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw className={sync.isPending ? 'animate-spin' : undefined} />
            {t('sync')}
          </Button>
        }
      />
      <CardBody>
        {sync.error ? <ErrorBox error={sync.error} /> : null}
        <dl className="divide-y divide-line-subtle">
          <KeyValue label={t('installations')}>
            {view.installations.length === 0 ? (
              <span className="text-subtle">
                {view.projectionAvailable
                  ? t('noneSynced', { defaultValue: 'none synced yet' })
                  : t('projectionUnavailable', { defaultValue: 'the projection is unavailable' })}
              </span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {view.installations.map((installation) => (
                  <Badge
                    key={installation.installationId}
                    tone={installation.suspended ? 'warn' : 'outline'}
                  >
                    {installation.accountLogin}
                    {installation.suspended ? ` (${t('suspended', { defaultValue: 'suspended' })})` : ''}
                  </Badge>
                ))}
              </div>
            )}
          </KeyValue>
          <KeyValue label={t('repositories')}>{view.repositoryCount}</KeyValue>
          <KeyValue label={t('rateLimit')}>
            {budget.remaining === null ? (
              <span className="text-subtle">{t('notReadYet', { defaultValue: 'not read yet' })}</span>
            ) : (
              <span className="tabular-nums">
                {budget.remaining}
                {budget.limit === null ? '' : ` / ${budget.limit}`}{' '}
                {t('rateLimitLeft', { defaultValue: 'left' })}
                {budget.resetAt === null ? '' : `, ${t('resets', { defaultValue: 'resets' })} ${relativeTime(budget.resetAt)}`}
              </span>
            )}
          </KeyValue>
          <KeyValue label={t('lastSync')}>
            {view.sync.length === 0 ? (
              <span className="text-subtle">{t('never', { defaultValue: 'never' })}</span>
            ) : (
              <div className="space-y-0.5 text-xs">
                {view.sync.map((entry) => (
                  <div key={entry.scope}>
                    <Mono kind="text" tone="ink">{entry.scope}</Mono>{' '}
                    <span className="text-subtle">
                      {entry.lastSyncedAt === null ? t('never', { defaultValue: 'never' }) : relativeTime(entry.lastSyncedAt)}
                    </span>
                    {entry.lastError ? <span className="ml-2 text-danger">{entry.lastError}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </KeyValue>
        </dl>
        <p className="mt-3 text-xs text-subtle">
          {t('projectionNote', {
            defaultValue:
              "The projection is read from the panel's own database, so this list answers while GitHub is unreachable. No token, key or webhook secret is ever returned by the API.",
          })}
        </p>
      </CardBody>
    </Card>
  )
}
