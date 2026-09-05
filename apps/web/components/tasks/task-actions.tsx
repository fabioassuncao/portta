'use client'

import { useTranslation } from 'react-i18next'
import { ChevronDown, MoreHorizontal, Trash2 } from 'lucide-react'
import type { Task, TaskStatus } from 'portta-contracts'
import { Button } from '../ui/button.tsx'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui/menu.tsx'
import { Tooltip } from '../ui/tooltip.tsx'
import { useTaskStatuses } from '@/lib/i18n/use-task-statuses.ts'
import { TaskStatusBadge } from '../entities/task-badges.tsx'

/**
 * What a person can do to a task, said in the words of what it actually does.
 *
 * The old bar had "Start" and "Finish", which hid two different things behind
 * one verb each. Start moves the status *and* assigns the task to whoever
 * pressed it; Finish moves the status *and*, for a bound task, closes the
 * GitHub issue. Neither said so, so neither could be trusted.
 *
 * Now the status is one control that only changes status, and beside it sits
 * exactly one "next step" whose label and tooltip state the whole effect —
 * including the issue it will close, by number.
 *
 * There is no "run an agent" button here on purpose. Portta does not launch
 * agents: an agent announces its own session through the CLI. A button that
 * implied otherwise would be a lie about what this panel can do.
 */
export function TaskActions({
  task,
  readOnly = false,
  onSetStatus,
  onStart,
  onFinish,
  onDiscard,
}: {
  task: Task
  readOnly?: boolean
  onSetStatus: (status: TaskStatus) => void
  /** Moves to in_progress and assigns the caller, in one write. */
  onStart: () => void
  /** Moves to done; `close` also closes the bound GitHub issue. */
  onFinish: (close: boolean) => void
  onDiscard: () => void
}) {
  const { t } = useTranslation('tasks')
  const { t: tc } = useTranslation('common')
  const { statusOptions } = useTaskStatuses()
  const issue = task.github ? `${task.github.repository}#${task.github.number}` : null

  const next = nextStepFor(task)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Menu>
        <MenuTrigger asChild>
          <Button size="sm" variant="default" disabled={readOnly} aria-label={t('detail.changeStatus')}>
            <span className="text-subtle">{t('detail.statusLabel')}</span>
            <TaskStatusBadge status={task.status} />
            <ChevronDown aria-hidden />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>{t('detail.changeStatus')}</MenuLabel>
          {statusOptions.map((entry) => (
            <MenuItem
              key={entry.value}
              disabled={readOnly || entry.value === task.status}
              onSelect={() => onSetStatus(entry.value as TaskStatus)}
            >
              {entry.label}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>

      {next ? (
        <Tooltip
          label={
            next.kind === 'start' ? t('detail.startAndTakeHint')
              : next.kind === 'review' ? t('detail.sendToReviewHint')
                : next.kind === 'reopen' ? t('detail.reopenHint')
                  : issue ? t('detail.markDoneAndCloseHint', { issue }) : t('detail.markDoneHint')
          }
        >
          <Button
            size="sm"
            variant="primary"
            disabled={readOnly}
            onClick={() => {
              if (next.kind === 'start') onStart()
              else if (next.kind === 'review') onSetStatus('review')
              else if (next.kind === 'reopen') onSetStatus('in_progress')
              else onFinish(Boolean(task.github))
            }}
          >
            {next.kind === 'start' ? t('detail.startAndTake')
              : next.kind === 'review' ? t('detail.sendToReview')
                : next.kind === 'reopen' ? t('detail.reopen')
                  : issue ? t('detail.markDoneAndClose') : t('detail.markDone')}
          </Button>
        </Tooltip>
      ) : null}

      <Menu>
        <MenuTrigger asChild>
          <Button size="icon" variant="ghost" disabled={readOnly} aria-label={tc('actions')}>
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent>
          {task.status !== 'done' && next?.kind !== 'done' ? (
            <>
              <MenuItem onSelect={() => onFinish(Boolean(task.github))}>
                {issue ? t('detail.markDoneAndClose') : t('detail.markDone')}
              </MenuItem>
              <MenuSeparator />
            </>
          ) : null}
          <MenuItem tone="danger" icon={<Trash2 />} onSelect={onDiscard}>
            {task.draft ? t('draft.discard') : tc('delete')}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}

/**
 * The single move that follows from where the task is. One button, because
 * offering four equal buttons is how the old bar made every one of them look
 * optional.
 */
export function nextStepFor(task: Pick<Task, 'status'>): { kind: 'start' | 'review' | 'done' | 'reopen' } | null {
  switch (task.status) {
    case 'backlog':
    case 'ready':
    case 'blocked':
      return { kind: 'start' }
    case 'in_progress':
      return { kind: 'review' }
    case 'review':
      return { kind: 'done' }
    case 'done':
      return { kind: 'reopen' }
    default:
      return null
  }
}
