'use client'

// The overview tab: what needs doing, who is on it, what code it has, what is
// running, and what happened.

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import type { ActivityEvent, Environment, Project, ProjectEnvironment, Session, TaskSummary } from 'portta-contracts'
import { Badge, StatusIndicator } from '@/components/ui/badge'
import { Card, CardBody, CardHeader, CardSection } from '@/components/ui/card'
import { RepositoryRow } from '@/components/entities/repository-row'
import { EnvironmentCard } from '@/components/entities/environment-card'
import { ResourceUsage } from '@/components/entities/resource-usage'
import { SessionRow } from '@/components/entities/session-row'
import { ActivityTimeline } from '@/components/entities/activity-timeline'
import { TaskRow } from '@/components/entities/task-row'
import { Empty, Loading, SectionHeader } from '@/components/shell-bits'
import { environmentHealth, healthTone } from '@/lib/health'
import { useEnvironments, useMetricsCurrent, useNextTask, useProjectActivity, useSessions, useTasks } from '@/lib/queries'
import { taskHref, tasksHref } from '@/lib/tasks'

export function ProjectOverview({
  project,
  readOnly,
  initialTasks,
  initialSessions,
  initialActivity,
}: {
  project: Project
  readOnly: boolean
  initialTasks: TaskSummary[]
  initialSessions: Session[]
  initialActivity: ActivityEvent[]
}) {
  const { t } = useTranslation('projects')
  const { t: tk } = useTranslation('tasks')
  const { t: ts } = useTranslation('sessions')
  const { t: ta } = useTranslation('activity')
  const tasks = useTasks(project.slug, { open: 'true' })
  const next = useNextTask(project.slug)
  const sessions = useSessions(project.slug, { active: true })
  const activity = useProjectActivity(project.slug, { limit: '20' })
  const environments = useEnvironments(true)
  const metrics = useMetricsCurrent()

  // The server read these for this render, so the page is the page on first
  // paint; the queries take over the moment they answer.
  const openTasks = tasks.data ?? initialTasks.filter((task) => task.status !== 'done')
  const activeSessions = sessions.data ?? initialSessions
  const events = activity.data?.events ?? initialActivity

  const known = new Map((environments.data ?? []).map((environment) => [environment.name, environment]))
  const adopted = project.environments
    .map((entry) => known.get(entry.environment))
    .filter((environment): environment is Environment => environment !== undefined)
  const measured = (metrics.data?.projects ?? []).filter((entry) =>
    project.environments.some((link) => link.environment === entry.composeProject))
  const cpu = measured.reduce<number | null>((sum, entry) => (entry.cpuUtilisation === null ? sum : (sum ?? 0) + entry.cpuUtilisation), null)
  const memory = measured.reduce<number | null>((sum, entry) => (entry.memoryUsedBytes === null ? sum : (sum ?? 0) + entry.memoryUsedBytes), null)
  const inProgress = openTasks.filter((task) => task.status === 'in_progress')
  const blocked = openTasks.filter((task) => task.status === 'blocked')
  const review = openTasks.filter((task) => task.status === 'review')

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={t('overview.development')}
            description={t('overview.developmentDescription', { open: openTasks.length, inProgress: inProgress.length, blocked: blocked.length })}
            actions={<Link className="rounded-xs text-xs text-accent hover:underline focus-ring" href={tasksHref(project.slug, 'board')}>{t('overview.allTasks')}</Link>}
          />
          <Section label={tk('status.inProgress')} tasks={inProgress} slug={project.slug} empty={t('overview.nothingInProgress')} />
          <Section label={tk('status.review')} tasks={review} slug={project.slug} />
          <Section label={tk('status.blocked')} tasks={blocked} slug={project.slug} />
          <div className="flex h-9 items-center gap-1.5 border-t border-line px-3 text-sm">
            <span className="text-xs text-subtle">{t('overview.next')}: </span>
            {next.data ? (
              <Link className="min-w-0 truncate rounded-xs underline-offset-2 hover:underline focus-ring" href={taskHref(project.slug, next.data.id)}>#{next.data.id} {next.data.title}</Link>
            ) : (
              <span className="text-subtle">{t('overview.nothingNext')}</span>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={ts('active', { count: activeSessions.length })} />
            {activeSessions.length === 0 ? (
              <Empty title={ts('none')} hint={ts('noneHint', { slug: project.slug })} />
            ) : (
              activeSessions.map((session) => <SessionRow key={session.id} session={session} />)
            )}
          </Card>
          <Card>
            <CardHeader title={t('overview.resources')} />
            <CardBody>
              {measured.length === 0 ? (
                <p className="text-xs text-subtle">{t('overview.noMeasurement')}</p>
              ) : (
                <ResourceUsage cpu={cpu} memoryBytes={memory} variant="bar" stale={metrics.data?.stale} />
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title={t('repositoriesCard.title')}
          description={t('repositoriesCard.description')}
          actions={<Link className="rounded-xs text-xs text-accent hover:underline focus-ring" href={`/projects/${encodeURIComponent(project.slug)}/repositories`}>{t('overview.manageRepositories')}</Link>}
        />
        {project.repositories.length === 0 ? (
          <Empty title={t('repositoriesCard.empty')} hint={t('repositoriesCard.emptyHint')} />
        ) : (
          project.repositories.map((repository) => (
            <RepositoryRow key={repository.id} repository={repository} projectSlug={project.slug} density="card" />
          ))
        )}
      </Card>

      <div className="space-y-3">
        <SectionHeader
          title={t('environments.title')}
          actions={<Link className="rounded-xs text-xs text-accent hover:underline focus-ring" href={`/projects/${encodeURIComponent(project.slug)}/environments`}>{t('overview.manageEnvironments')}</Link>}
        />
        {project.environments.length === 0 ? (
          <Card><Empty title={t('environments.empty')} hint={t('environments.emptyHint')} /></Card>
        ) : adopted.length === 0 ? (
          <Card>
            {project.environments.map((environment) => <AdoptedRow key={environment.environment} environment={environment} />)}
          </Card>
        ) : (
          adopted.map((environment) => (
            <EnvironmentCard key={environment.name} environment={environment} owner={{ slug: project.slug, name: project.name }} readOnly={readOnly} />
          ))
        )}
      </div>

      <Card>
        <CardHeader
          title={ta('recent')}
          actions={<Link className="rounded-xs text-xs text-accent hover:underline focus-ring" href={`/projects/${encodeURIComponent(project.slug)}/activity`}>{ta('all')}</Link>}
        />
        {activity.isPending && events.length === 0 ? <Loading /> : <ActivityTimeline events={events} compact />}
      </Card>
    </div>
  )
}

function Section({ label, tasks, slug, empty }: { label: string; tasks: TaskSummary[]; slug: string; empty?: string }) {
  if (tasks.length === 0 && !empty) return null
  return (
    <CardSection label={label} count={tasks.length}>
      {tasks.length === 0 ? <p className="px-3 py-2 text-xs text-subtle">{empty}</p> : tasks.map((task) => <TaskRow key={task.id} task={task} href={taskHref(slug, task.id)} compact />)}
    </CardSection>
  )
}

/**
 * The adopted environment when the list does not carry it in full. One with no
 * services at all is a remembered one (its containers are gone), which the link
 * carries no presence for: "0/0 running" would be the wrong word.
 */
export function AdoptedRow({ environment }: { environment: ProjectEnvironment }) {
  const { t } = useTranslation('projects')
  const { t: te } = useTranslation('environments')
  const health = environmentHealth(environment)
  const remembered = environment.serviceCount === 0 && !environment.running
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-line-subtle px-3 py-1.5 text-sm last:border-b-0 hover:bg-fill">
      <Link className="rounded-xs font-medium underline-offset-2 hover:underline focus-ring" href={`/environments/${encodeURIComponent(environment.environment)}`}>
        {environment.environment}
      </Link>
      {remembered ? (
        <Badge tone="outline">{te('presence.remembered')}</Badge>
      ) : (
        <StatusIndicator tone={healthTone(health)}>{t('running', { running: environment.runningCount, total: environment.serviceCount })}</StatusIndicator>
      )}
      {environment.unhealthyCount > 0 ? <Badge tone="danger">{t('detail.unhealthyCount', { count: environment.unhealthyCount })}</Badge> : null}
      <span className="text-xs text-subtle">{t(sourceKey(environment.source))}</span>
    </div>
  )
}

export function sourceKey(source: ProjectEnvironment['source']): 'detail.sourceReason.repoMatch' | 'detail.sourceReason.label' | 'detail.sourceReason.path' | 'detail.sourceReason.manual' {
  return source === 'repo-match' ? 'detail.sourceReason.repoMatch' : source === 'label' ? 'detail.sourceReason.label' : source === 'path' ? 'detail.sourceReason.path' : 'detail.sourceReason.manual'
}
