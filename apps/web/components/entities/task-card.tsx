'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { AlertTriangle, MoreHorizontal } from 'lucide-react'
import type { TaskStatus, TaskSummary } from 'portta-contracts'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui/menu.tsx'
import { iconButton } from '../ui/surfaces.ts'
import { cn } from '../../lib/utils.ts'
import { navigate } from '../../lib/navigation.ts'
import { priorityIcon, priorityTone, statusIcon, statusTone } from '../../lib/task-presentation.ts'
import { narrowTone, toneText } from '../../lib/tone.ts'
import type { BoardColumn } from '@/lib/i18n/use-task-statuses.ts'
import { TaskGitHubBadge, TaskLabels, TaskTypeBadge, TaskWorker } from './task-badges.tsx'

/**
 * One card on the board.
 *
 * Draggable by pointer and movable from its menu, so the board is not a
 * mouse-only feature. The card says what a glance needs — id, title, the
 * priority and the kind as icons, the labels, who is on it — and leaves the
 * rest to the task page. A column of twenty of these should read as a list.
 */
export function TaskCard({
  task,
  columns,
  href,
  onMove,
  onOpen,
  readOnly = false,
  showRepository = true,
  showProject = false,
  projectName,
}: {
  task: TaskSummary
  columns: BoardColumn[]
  href: string
  onMove: (task: TaskSummary, status: TaskStatus, targetId?: string, edge?: 'before' | 'after') => void
  onOpen?: (task: TaskSummary) => void
  readOnly?: boolean
  showRepository?: boolean
  showProject?: boolean
  projectName?: string
}) {
  const { t } = useTranslation('tasks')
  const { t: tc } = useTranslation('common')
  const { priorityLabel } = usePriorityLabel()
  const element = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [closestEdge, setClosestEdge] = useState<'before' | 'after' | null>(null)

  useEffect(() => {
    const node = element.current
    if (node === null || readOnly) return
    return combine(
      draggable({
        element: node,
        getInitialData: () => ({ task }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element: node,
        canDrop: ({ source }) => (source.data['task'] as TaskSummary | undefined)?.id !== task.id,
        getData: ({ input, element }) => ({
          type: 'task-card', taskId: task.id,
          edge: input.clientY < element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2 ? 'before' : 'after',
        }),
        onDrag: ({ self }) => setClosestEdge(self.data['edge'] as 'before' | 'after'),
        onDragLeave: () => setClosestEdge(null),
        onDrop: ({ source, self }) => {
          setClosestEdge(null)
          const dragged = source.data['task'] as TaskSummary | undefined
          if (dragged) onMove(dragged, task.status, task.id, self.data['edge'] as 'before' | 'after')
        },
      }),
    )
  }, [task, readOnly, onMove])

  const StatusIcon = statusIcon(task.status)
  const PriorityIcon = priorityIcon(task.priority)

  return (
    <div
      ref={element}
      role="article"
      aria-label={`#${task.id} ${task.title}`}
      tabIndex={0}
      className={cn(
        'group relative rounded-md border border-line bg-surface px-2.5 py-2 text-sm',
        'transition-colors duration-100 hover:border-line-strong focus-ring',
        !readOnly && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-50 ring-1 ring-accent/50',
        closestEdge === 'before' && 'after:pointer-events-none after:absolute after:inset-x-0 after:-top-1 after:h-0.5 after:rounded-full after:bg-accent',
        closestEdge === 'after' && 'after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-accent',
      )}
    >
      <div className="flex h-5 min-w-0 items-center gap-1.5">
        <a className="font-mono text-2xs text-subtle underline-offset-2 hover:text-ink hover:underline focus-ring rounded-xs" href={href}>
          #{task.id}
        </a>
        {task.github?.syncState === 'conflict' ? (
          <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-label={t('sync.conflict')} />
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <TaskWorker task={task} />
          <Menu>
            <MenuTrigger
              aria-label={t('actionsFor', { id: task.id })}
              className={cn(iconButton, 'size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100')}
            >
              <MoreHorizontal />
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => (onOpen ? onOpen(task) : navigate(href))}>{tc('open')}</MenuItem>
              <MenuSeparator />
              <MenuLabel>{t('table.status')}</MenuLabel>
              {columns.map((column) => (
                <MenuItem
                  key={column.id}
                  disabled={readOnly || task.status === column.status}
                  onSelect={() => onMove(task, column.status)}
                >
                  {t('moveTo', { label: column.label })}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </span>
      </div>

      <a href={href} className="mt-0.5 flex items-start gap-1.5 rounded-xs focus-ring">
        <StatusIcon className={cn('mt-0.5 size-3.5 shrink-0', toneText[narrowTone(statusTone(task.status))])} aria-hidden />
        <span className="line-clamp-3 text-sm font-medium leading-snug text-ink">{task.title}</span>
      </a>

      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1 text-2xs text-subtle">
        {showProject ? (
          <a
            className="max-w-28 truncate rounded-xs text-2xs text-subtle underline-offset-2 hover:text-ink hover:underline focus-ring"
            href={`/projects/${encodeURIComponent(task.project)}`}
          >
            {projectName ?? task.project}
          </a>
        ) : null}
        {PriorityIcon ? (
          <span className="inline-flex size-5 items-center justify-center rounded-full border border-line bg-surface" title={priorityLabel(task.priority)}>
            <PriorityIcon className={cn('size-3', toneText[narrowTone(priorityTone(task.priority))])} aria-label={priorityLabel(task.priority)} />
          </span>
        ) : null}
        <TaskTypeBadge type={task.type} chip />
        {task.labels.length > 0 ? <TaskLabels labels={task.labels} max={2} /> : null}
        {showRepository && task.repository ? (
          <span className="inline-flex h-5 items-center rounded-full border border-line bg-surface px-1.5 text-2xs text-muted">{task.repository.name}</span>
        ) : null}
        {task.subtaskCount > 0 ? (
          <span className="tabular-nums">{t('subtasksCount', { done: task.subtaskCount - task.openSubtaskCount, total: task.subtaskCount })}</span>
        ) : null}
        <TaskGitHubBadge github={task.github} compact />
      </div>
    </div>
  )
}

function usePriorityLabel() {
  const { t } = useTranslation('tasks')
  return {
    priorityLabel: (priority: TaskSummary['priority']) =>
      priority ? t(`priority.${priority}` as 'priority.low') : '',
  }
}
