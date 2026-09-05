'use client'

// The top of every environment tab: what it is, what it belongs to, how it is
// doing, and the operations its state allows.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import type { Environment } from 'portta-contracts'
import { useEnvironmentGit } from '@/lib/queries'
import type { EnvironmentOwner } from '@/lib/queries/projects'
import { environmentHealth, healthTone } from '@/lib/health'
import { narrowTone } from '@/lib/tone'
import { useFormat } from '@/lib/use-format'
import { useCan } from '@/lib/permissions'
import { Badge, StatusIndicator } from '@/components/ui/badge'
import { PageHeader } from '@/components/shell-bits'
import type { BreadcrumbItem } from '@/components/ui/breadcrumb'
import { EnvironmentActions } from '@/components/environment-actions'
import { EnvironmentOperations } from '@/components/environment-operations'
import { GitStatusLine } from '@/components/entities/git-status-line'
import { EnvironmentOpenMenu } from '@/components/entities/open-test-menu'
import { repositoryHref } from '@/components/entities/repository-row'
import { useTaskStatuses } from '@/lib/i18n/use-task-statuses'
import { Mono } from '@/components/copy'

export function EnvironmentHeader({ environment, owner }: { environment: Environment; owner: EnvironmentOwner | null }) {
  const { t } = useTranslation('environments')
  const { t: tn } = useTranslation('nav')
  const { uptime } = useFormat()
  const router = useRouter()
  const git = useEnvironmentGit(environment.name)
  const health = environmentHealth(environment)
  const remembered = environment.presence === 'remembered'
  const shown = environment.overrides?.displayName ?? environment.name
  const mayOperate = useCan('environment:operate')
  const mayDestroy = useCan('environment:destroy')

  const breadcrumb: BreadcrumbItem[] = owner
    ? [
        { label: tn('projects'), href: '/projects' },
        { label: owner.name, href: `/projects/${encodeURIComponent(owner.slug)}` },
        { label: tn('environments'), href: `/projects/${encodeURIComponent(owner.slug)}/environments` },
        { label: shown },
      ]
    : [{ label: tn('environments'), href: '/environments' }, { label: shown }]

  return (
    <>
      <PageHeader
        title={shown}
        breadcrumb={breadcrumb}
        description={
          [
            environment.overrides?.displayName ? t('derivedName', { name: environment.name }) : null,
            environment.overrides?.description ?? null,
            environment.uptimeSeconds !== null ? t('up', { time: uptime(environment.uptimeSeconds) }) : null,
            environment.workingDir,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        meta={
          <>
            {remembered ? (
              <Badge tone="outline">{t('presence.remembered')}</Badge>
            ) : (
              <StatusIndicator tone={narrowTone(healthTone(health))}>{t('header.services', { running: environment.runningCount, total: environment.serviceCount })}</StatusIndicator>
            )}
            {!remembered && environment.unhealthyCount > 0 ? <StatusIndicator tone="danger">{t('unhealthy', { count: environment.unhealthyCount })}</StatusIndicator> : null}
            {owner ? (
              owner.repository ? (
                <Link className="rounded-xs text-accent underline-offset-2 hover:underline focus-ring" href={repositoryHref(owner.slug, owner.repository.id)}>
                  {t('header.openRepository')}: {owner.repository.name}
                </Link>
              ) : null
            ) : environment.group ? (
              <Badge tone="outline">{t('partOf', { group: environment.group })}</Badge>
            ) : (
              <span className="text-subtle">{t('header.noProject')}</span>
            )}
            {environment.namespace ? <Badge tone="outline">{t('worktree', { name: environment.namespace })}</Badge> : null}
            {environment.repoUrl ? (
              <a className="rounded-xs text-muted underline-offset-2 hover:text-ink hover:underline focus-ring" href={environment.repoUrl} target="_blank" rel="noreferrer noopener">{environment.repo}</a>
            ) : null}
            <Mono kind="text" tone="subtle" className="text-xs">{environment.networks.join(', ')}</Mono>
          </>
        }
        actions={
          <>
            {environment.urls.length > 0 ? <EnvironmentOpenMenu environment={environment} /> : null}
            {/* Start, stop and restart are `environment:operate`. Forgetting
                the panel's row, rebuilding and removing are `destroy`, and a
                developer holds the first and not the second. */}
            {mayOperate ? (
              <EnvironmentActions
                project={environment}
                mayForget={mayDestroy}
                onForgotten={() => router.push('/environments')}
              />
            ) : null}
            {remembered || !mayDestroy ? null : <EnvironmentOperations project={environment} />}
          </>
        }
      />
      {git.data || environment.task || environment.issue ? (
        <div className="mb-4 divide-y divide-line rounded-lg border border-line bg-surface">
          {git.data ? <GitStatusLine git={git.data} variant="line" /> : null}
          {environment.task ? <TaskLine task={environment.task} /> : environment.issue ? <IssueLine issue={environment.issue} /> : null}
        </div>
      ) : null}
    </>
  )
}

function TaskLine({ task }: { task: NonNullable<Environment['task']> }) {
  const { t } = useTranslation('environments')
  const { statusLabel, priorityLabel } = useTaskStatuses()
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
      <span className="text-subtle">{t('header.task')}</span>
      <Link className="rounded-xs font-medium text-ink underline-offset-2 hover:underline focus-ring" href={task.panelUrl}>#{task.id} {task.title}</Link>
      <Badge tone="accent">{statusLabel(task.status)}</Badge>
      {task.priority ? <Badge tone="warn">{priorityLabel(task.priority)}</Badge> : null}
      {task.agent ? <Badge tone="outline">{task.agent}</Badge> : task.assignee ? <Badge tone="outline">{task.assignee}</Badge> : null}
      {task.github ? (
        <a className="text-muted underline-offset-2 hover:underline" href={task.github.htmlUrl} target="_blank" rel="noreferrer noopener">
          {task.github.repository}#{task.github.number}
        </a>
      ) : null}
      <span className="text-subtle">{task.reason}</span>
    </div>
  )
}

function IssueLine({ issue }: { issue: NonNullable<Environment['issue']> }) {
  const { t } = useTranslation('environments')
  const { statusLabel, priorityLabel } = useTaskStatuses()
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
      <span className="text-subtle">{t('header.task')}</span>
      <Badge tone="outline">{issue.repository}</Badge>
      <a className="underline-offset-2 hover:underline" href={issue.htmlUrl} target="_blank" rel="noreferrer noopener">#{issue.number}</a>
      <span className="min-w-0 truncate font-medium text-ink">{issue.title}</span>
      {issue.status ? <Badge tone="accent">{statusLabel(issue.status)}</Badge> : null}
      {issue.priority ? <Badge tone="warn">{priorityLabel(issue.priority)}</Badge> : null}
      <span className="text-subtle">{issue.reason}</span>
    </div>
  )
}
