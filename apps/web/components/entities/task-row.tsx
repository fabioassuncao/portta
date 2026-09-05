'use client'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskSummary } from 'portta-contracts'
import { Tooltip } from '../ui/tooltip.tsx'
import { useFormat } from '../../lib/use-format.ts'
import { cn } from '../../lib/utils.ts'
import { priorityIcon, priorityTone, statusIcon, statusTone } from '../../lib/task-presentation.ts'
import { narrowTone, toneText } from '../../lib/tone.ts'
import { useTaskStatuses } from '@/lib/i18n/use-task-statuses.ts'
import { TaskGitHubBadge, TaskLabels, TaskTypeBadge, TaskWorker } from './task-badges.tsx'

/**
 * One task in a list.
 *
 * The row has one job: let the eye find the right task and open it. So the
 * title owns the width and everything else is pushed to the trailing edge in a
 * fixed order — who is on it, what state it is in, how long since it moved —
 * which is what makes a column of these scannable rather than a wall of
 * badges. Status and priority are icons, as on a board card, so the row is
 * one line of text with a few marks beside it. `depth` indents a subtask
 * under its parent; `compact` drops the detail a dashboard column has no
 * room for.
 */
export function TaskRow({
  task,
  href,
  depth = 0,
  compact = false,
  showProject = false,
  /** How long since it last moved. On a dashboard this is the whole point. */
  showAge = false,
  actions,
  className,
}: {
  task: TaskSummary
  href: string
  depth?: number
  compact?: boolean
  showProject?: boolean
  showAge?: boolean
  actions?: ReactNode
  className?: string
}) {
  const { t } = useTranslation('tasks')
  const { relativeTime } = useFormat()
  const { statusLabel, priorityLabel } = useTaskStatuses()
  const StatusIcon = statusIcon(task.status)
  const PriorityIcon = priorityIcon(task.priority)
  return (
    <div
      role="group"
      aria-label={`#${task.id} ${task.title}`}
      className={cn(
        'group flex h-9 min-w-0 items-center gap-2 border-b border-line-subtle px-3 text-sm transition-colors duration-100 last:border-b-0 hover:bg-fill',
        className,
      )}
      style={{ paddingLeft: `${12 + depth * 20}px` }}
    >
      {PriorityIcon ? (
        <PriorityIcon className={cn('size-3.5 shrink-0', toneText[narrowTone(priorityTone(task.priority))])} aria-label={priorityLabel(task.priority as NonNullable<TaskSummary['priority']>)} />
      ) : (
        <span className="size-3.5 shrink-0" aria-hidden />
      )}
      <a className="w-10 shrink-0 truncate rounded-xs font-mono text-2xs text-subtle underline-offset-2 hover:text-ink hover:underline focus-ring" href={href}>
        #{task.id}
      </a>
      <StatusIcon className={cn('size-3.5 shrink-0', toneText[narrowTone(statusTone(task.status))])} aria-label={statusLabel(task.status)} />
      <a className="min-w-0 flex-1 truncate rounded-xs text-ink underline-offset-2 hover:underline focus-ring" href={href}>
        {task.title}
      </a>

      <div className="flex shrink-0 items-center gap-2">
        {showProject ? (
          <a
            className="hidden max-w-32 truncate rounded-xs text-xs text-subtle underline-offset-2 hover:text-ink hover:underline focus-ring sm:inline"
            href={`/projects/${encodeURIComponent(task.project)}`}
          >
            {task.project}
          </a>
        ) : null}
        {!compact && task.labels.length > 0 ? <TaskLabels labels={task.labels} max={2} className="hidden xl:inline-flex" /> : null}
        <TaskTypeBadge type={task.type} className="hidden lg:inline-flex" />
        {task.repository ? <span className="hidden text-xs text-subtle lg:inline">{task.repository.name}</span> : null}
        {!compact && task.subtaskCount > 0 ? (
          <span className="hidden text-xs text-subtle tabular-nums lg:inline">
            {t('subtasksCount', { done: task.subtaskCount - task.openSubtaskCount, total: task.subtaskCount })}
          </span>
        ) : null}
        <TaskGitHubBadge github={task.github} compact />
        <TaskWorker task={task} />
        {showAge || !compact ? (
          <Tooltip label={t('updatedAgo', { time: relativeTime(task.updatedAt) })}>
            <span tabIndex={0} className="hidden min-w-14 shrink-0 rounded-xs text-right text-xs whitespace-nowrap text-subtle tabular-nums focus-ring sm:inline">
              {relativeTime(task.updatedAt)}
            </span>
          </Tooltip>
        ) : null}
        {actions}
      </div>
    </div>
  )
}
