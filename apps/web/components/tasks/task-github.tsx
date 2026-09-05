'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import type { Task } from 'portta-contracts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Input, Select } from '../ui/field.tsx'
import { Eyebrow } from '../shell-bits.tsx'
import { syncTone } from '../../lib/task-presentation.ts'
import { narrowTone } from '../../lib/tone.ts'
import { useFormat } from '../../lib/use-format.ts'

export function TaskGitHubCard({
  task,
  readOnly,
  configured,
  link,
  unlink,
  publish,
  sync,
}: {
  task: Task
  readOnly?: boolean
  configured: boolean
  link: (issue: string, initialSync: 'pull' | 'push') => Promise<unknown>
  unlink: () => void
  publish: () => void
  sync: (resolve?: 'local' | 'remote') => void
}) {
  const { t } = useTranslation('tasks')
  const { relativeTime } = useFormat()
  const [issueRef, setIssueRef] = useState('')
  const [initialSync, setInitialSync] = useState<'pull' | 'push'>('pull')
  const github = task.github

  return (
    <div>
      <Eyebrow className="mb-1.5">{t('github.section')}</Eyebrow>
      {github ? (
        <div className="space-y-1.5 text-sm">
          <a className="inline-flex items-center gap-1 rounded-xs font-mono text-xs text-ink hover:text-accent focus-ring" href={github.htmlUrl} target="_blank" rel="noreferrer noopener">
            {github.repository}#{github.number} <ExternalLink className="size-3" />
          </a>
          <div className="flex flex-wrap gap-1">
            <Badge tone={github.state === 'open' ? 'ok' : 'neutral'}>{t(`github.state.${github.state}`)}</Badge>
            <Badge tone={narrowTone(syncTone(github.syncState))}>{t(`sync.${github.syncState}`)}</Badge>
          </div>
          {github.lastSyncedAt ? <p className="text-xs text-subtle">{t('github.lastSynced', { time: relativeTime(github.lastSyncedAt) })}</p> : null}
          {github.lastError ? <p className="text-xs text-danger">{github.lastError}</p> : null}
          {github.syncState === 'conflict' && github.remote ? (
            <p className="text-xs text-muted">{t('github.conflictExplained', { title: github.remote.title, status: github.remote.status ?? '—', assignee: github.remote.assignee ?? '—' })}</p>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {github.syncState === 'conflict' ? (
              <>
                <Button size="sm" disabled={readOnly} onClick={() => sync('local')}>{t('github.keepLocal')}</Button>
                <Button size="sm" disabled={readOnly} onClick={() => sync('remote')}>{t('github.takeRemote')}</Button>
              </>
            ) : (
              <Button size="sm" disabled={readOnly || !configured} onClick={() => sync()}>{t('github.sync')}</Button>
            )}
            <Button size="sm" variant="ghost" disabled={readOnly} onClick={unlink}>{t('github.unlink')}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-subtle">{t('github.notBound')}</p>
          <form className="space-y-1.5" onSubmit={(event) => { event.preventDefault(); if (issueRef.trim()) void link(issueRef.trim(), initialSync).then(() => setIssueRef('')) }}>
            <Input size="sm" mono value={issueRef} onChange={(event) => setIssueRef(event.target.value)} placeholder="owner/repo#42" disabled={readOnly || !configured} />
            <Select size="sm" value={initialSync} onChange={(event) => setInitialSync(event.target.value as 'pull' | 'push')} className="w-full" disabled={readOnly || !configured} aria-label={t('github.initialSync')}>
              <option value="pull">{t('github.pullFirst')}</option>
              <option value="push">{t('github.pushFirst')}</option>
            </Select>
            <Button size="sm" type="submit" disabled={readOnly || !configured || issueRef.trim() === ''}>{t('github.link')}</Button>
          </form>
          <Button size="sm" disabled={readOnly || !configured || !task.repository || task.draft} title={task.draft ? t('github.publishNeedsTitle') : !task.repository ? t('github.publishNeedsRepository') : undefined} onClick={publish}>
            {t('github.publish')}
          </Button>
        </div>
      )}
    </div>
  )
}
