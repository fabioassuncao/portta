'use client'

import { useTranslation } from 'react-i18next'
import { Bot, GitPullRequestArrow, User } from 'lucide-react'
import type { TaskPriority, TaskStatus, TaskSummary } from 'portta-contracts'
import { Badge } from '../ui/badge.tsx'
import { Tooltip } from '../ui/tooltip.tsx'
import { useTaskStatuses } from '@/lib/i18n/use-task-statuses.ts'
import {
  labelHue,
  priorityIcon,
  priorityTone,
  statusIcon,
  statusTone,
  syncTone,
  typeIcon,
  typeTone,
  type Tone as TaskTone,
} from '../../lib/task-presentation.ts'
import { toneText, type Tone } from '../../lib/tone.ts'
import { taskWorker } from '../../lib/tasks.ts'
import { cn } from '../../lib/utils.ts'

function asTone(tone: TaskTone): Tone {
  return tone === 'outline' ? 'neutral' : tone
}

/**
 * A property of a task, drawn the one way it is drawn everywhere: a small
 * icon in the property's colour and the word beside it in plain text. The
 * icon carries the meaning, so a row of four of these is still one row of
 * text and not four coloured boxes. `chip` wraps it in a quiet pill for a
 * board card or a picker.
 */
function Property({
  icon: Icon,
  tone,
  children,
  chip = false,
  className,
  title,
}: {
  icon: typeof Bot | null
  tone: TaskTone
  children: React.ReactNode
  chip?: boolean
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap',
        chip ? 'h-5 rounded-full border border-line bg-surface px-1.5 text-2xs text-muted' : 'text-xs text-muted',
        className,
      )}
    >
      {Icon ? <Icon className={cn('size-3.5 shrink-0', toneText[asTone(tone)])} aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  )
}

/**
 * The one way a task's status is drawn. Board card, table row, detail page and
 * dashboard all render this, so a status cannot be amber in one place and grey
 * in another.
 */
export function TaskStatusBadge({
  status,
  source,
  chip = false,
  className,
}: {
  status: TaskStatus
  source?: 'fields' | 'labels' | 'none' | null
  chip?: boolean
  className?: string
}) {
  const { statusLabel } = useTaskStatuses()
  const { t } = useTranslation('tasks')
  return (
    <Property icon={statusIcon(status)} tone={statusTone(status)} chip={chip} title={source === 'labels' ? t('status.fromLabel') : undefined} className={className}>
      {statusLabel(status)}
      {source === 'labels' ? ' ·' : ''}
    </Property>
  )
}

export function TaskPriorityBadge({ priority, chip = false, className }: { priority: TaskPriority | null; chip?: boolean; className?: string }) {
  const { priorityLabel } = useTaskStatuses()
  if (!priority) return null
  return (
    <Property icon={priorityIcon(priority)} tone={priorityTone(priority)} chip={chip} className={className}>
      {priorityLabel(priority)}
    </Property>
  )
}

/**
 * What kind of work this is. The value stays whatever was stored — a task
 * typed "spike" still says "spike" — but a value the vocabulary recognises
 * gets that kind's colour and icon wherever it appears.
 */
export function TaskTypeBadge({ type, chip = false, className }: { type: string | null; chip?: boolean; className?: string }) {
  if (!type) return null
  return (
    <Property icon={typeIcon(type)} tone={typeTone(type)} chip={chip} className={className}>
      {type}
    </Property>
  )
}

/**
 * Labels, coloured from their own names so the same label is the same colour
 * in every list: a grey pill with a dot in the label's hue, which reads the
 * same in both themes. Beyond `max` they collapse into a count rather than
 * wrapping a row into three lines.
 */
export function TaskLabels({ labels, max = 3, className }: { labels: readonly string[]; max?: number; className?: string }) {
  if (labels.length === 0) return null
  const shown = labels.slice(0, max)
  const rest = labels.slice(max)
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-1', className)}>
      {shown.map((label) => (
        <span
          key={label}
          className="inline-flex h-5 max-w-40 items-center gap-1.5 rounded-full border border-line bg-surface px-1.5 text-2xs text-muted"
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: `oklch(0.68 0.15 ${labelHue(label)})` }}
          />
          <span className="truncate">{label}</span>
        </span>
      ))}
      {rest.length > 0 ? (
        <Tooltip label={rest.join(', ')}>
          <span tabIndex={0} className="rounded-xs text-2xs text-subtle focus-ring">
            +{rest.length}
          </span>
        </Tooltip>
      ) : null}
    </span>
  )
}

/** The GitHub issue a task is bound to, with the state of the binding. */
export function TaskGitHubBadge({ github, compact = false }: { github: TaskSummary['github']; compact?: boolean }) {
  const { t } = useTranslation('tasks')
  if (!github) return null
  return (
    <a
      className="inline-flex items-center gap-1 rounded-xs text-xs text-subtle underline-offset-2 hover:text-ink hover:underline focus-ring"
      href={github.htmlUrl}
      target="_blank"
      rel="noreferrer noopener"
      title={t(`sync.${github.syncState}`)}
    >
      <GitPullRequestArrow className="size-3.5" aria-hidden />
      <span className="font-mono text-2xs">{compact ? `#${github.number}` : `${github.repository}#${github.number}`}</span>
      {github.syncState !== 'synced' ? <Badge tone={asTone(syncTone(github.syncState))}>{t(`sync.${github.syncState}`)}</Badge> : null}
    </a>
  )
}

/** Who is on it: an agent in the agent colour, a person in neutral. */
export function TaskWorker({ task, className }: { task: Pick<TaskSummary, 'assignee' | 'agent'>; className?: string }) {
  const worker = taskWorker(task)
  const { t } = useTranslation('tasks')
  if (!worker) return null
  const agent = worker.kind === 'agent'
  const Icon = agent ? Bot : User
  return (
    <span
      className={cn('inline-flex max-w-36 items-center gap-1 truncate text-xs text-muted', className)}
      title={`${t(agent ? 'worker.agent' : 'worker.assignee')}: ${worker.name}`}
    >
      <Icon className={cn('size-3.5 shrink-0', agent ? 'text-agent' : 'text-subtle')} aria-hidden />
      <span className="truncate">{worker.name}</span>
    </span>
  )
}
