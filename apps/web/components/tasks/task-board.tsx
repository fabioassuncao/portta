'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import type { TaskStatus, TaskSummary } from 'portta-contracts'
import { Empty } from '../shell-bits.tsx'
import { cn } from '../../lib/utils.ts'
import { useBoardColumns, type BoardColumn } from '@/lib/i18n/use-task-statuses.ts'
import { columnFor, statusIcon, statusTone } from '../../lib/task-presentation.ts'
import { toneText } from '../../lib/tone.ts'
import { taskHref } from '../../lib/tasks.ts'
import { TaskCard } from '../entities/task-card.tsx'

/** A long column is capped rather than left to render two hundred rows. */
const COLUMN_CAP = 60

export function planBoardMove(
  tasks: TaskSummary[],
  task: TaskSummary,
  status: TaskStatus,
  targetId?: string,
  edge?: 'before' | 'after',
): { beforeId: string | null; afterId: string | null } | null {
  const destination = tasks.filter((entry) => entry.status === status && entry.id !== task.id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  let index = destination.length
  if (targetId) {
    const targetIndex = destination.findIndex((entry) => entry.id === targetId)
    if (targetIndex >= 0) index = targetIndex + (edge === 'after' ? 1 : 0)
  }
  const resultingIds = destination.map((entry) => entry.id)
  resultingIds.splice(index, 0, task.id)
  const originalIds = tasks.filter((entry) => entry.status === status).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map((entry) => entry.id)
  if (task.status === status && resultingIds.join('\0') === originalIds.join('\0')) return null
  return { beforeId: destination[index - 1]?.id ?? null, afterId: destination[index]?.id ?? null }
}

/**
 * The board.
 *
 * Columns are the statuses the domain actually has — nothing invented here —
 * and a card moves between them by drag, or from its menu for anyone not using
 * a pointer. While a drag is in flight every column says so, because a drop
 * target you cannot see is a drop target you will miss.
 *
 * The board scrolls sideways rather than reflowing into a grid: six columns
 * wrapped into two rows of three is not a board, and a tablet in landscape is
 * exactly where that used to happen.
 */
export function TaskBoard({
  slug,
  tasks,
  columns: columnsProp,
  onMove,
  onOpen,
  readOnly = false,
  showRepository = true,
  showProject = false,
  projectNames = {},
  from,
}: {
  slug?: string
  tasks: TaskSummary[]
  columns?: BoardColumn[]
  onMove: (task: TaskSummary, status: TaskStatus, beforeId: string | null, afterId: string | null) => void
  onOpen?: (task: TaskSummary) => void
  readOnly?: boolean
  /** False when the project has one repository and naming it on every card is noise. */
  showRepository?: boolean
  showProject?: boolean
  projectNames?: Record<string, string>
  from?: 'tasks'
}) {
  const { t } = useTranslation('tasks')
  const defaultColumns = useBoardColumns()
  const columns = columnsProp ?? defaultColumns
  const [announcement, setAnnouncement] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)

  // One monitor for the whole board rather than one per column: what every
  // column needs to know is only "is something being dragged right now".
  useEffect(() => {
    if (readOnly) return
    return monitorForElements({
      onDragStart: ({ source }) => setDragging((source.data['task'] as TaskSummary | undefined)?.status ?? null),
      onDrop: () => setDragging(null),
    })
  }, [readOnly])

  const move = useCallback((task: TaskSummary, status: TaskStatus, targetId?: string, edge?: 'before' | 'after'): void => {
    if (readOnly) return
    const planned = planBoardMove(tasks, task, status, targetId, edge)
    if (!planned) return
    onMove(task, status, planned.beforeId, planned.afterId)
    const column = columns.find((entry) => entry.status === status)
    setAnnouncement(t('movedAnnouncement', { id: task.id, column: column?.label ?? status }))
  }, [columns, onMove, readOnly, t, tasks])

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div className="-mx-4 flex min-h-0 flex-1 gap-2 overflow-x-auto px-4 pb-2 scroll-thin md:mx-0 md:px-0">
        {columns.map((column) => (
          <BoardColumnView
            key={column.id}
            slug={slug}
            column={column}
            tasks={tasks.filter((task) => columnFor(task, columns).id === column.id)}
            columns={columns}
            onMove={move}
            onOpen={onOpen}
            readOnly={readOnly}
            dragActive={dragging !== null}
            isSource={dragging === column.status}
            showRepository={showRepository}
            showProject={showProject}
            projectNames={projectNames}
            from={from}
          />
        ))}
      </div>
    </>
  )
}

function BoardColumnView({
  slug,
  column,
  tasks,
  columns,
  onMove,
  onOpen,
  readOnly,
  dragActive,
  isSource,
  showRepository,
  showProject,
  projectNames,
  from,
}: {
  slug?: string
  column: BoardColumn
  tasks: TaskSummary[]
  columns: BoardColumn[]
  onMove: (task: TaskSummary, status: TaskStatus, targetId?: string, edge?: 'before' | 'after') => void
  onOpen?: (task: TaskSummary) => void
  readOnly: boolean
  dragActive: boolean
  isSource: boolean
  showRepository: boolean
  showProject: boolean
  projectNames: Record<string, string>
  from?: 'tasks'
}) {
  const { t } = useTranslation('tasks')
  const region = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)

  useEffect(() => {
    const element = region.current
    if (element === null || readOnly) return
    return dropTargetForElements({
      element,
      getData: () => ({ type: 'task-column', columnId: column.id }),
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source, location }) => {
        setOver(false)
        if (location.current.dropTargets[0]?.data['type'] === 'task-card') return
        const task = source.data['task'] as TaskSummary | undefined
        if (task) onMove(task, column.status)
      },
    })
  }, [column.id, column.status, onMove, readOnly])

  const shown = [...tasks].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).slice(0, COLUMN_CAP)
  const Icon = statusIcon(column.status)
  const tone = statusTone(column.status)
  const iconTone = toneText[tone === 'outline' ? 'neutral' : tone]

  return (
    <section
      ref={region}
      aria-label={t('columnLabel', { label: column.label })}
      className={cn(
        'flex min-h-0 w-64 shrink-0 flex-col rounded-lg border bg-surface-2/50 transition-colors duration-100',
        over ? 'border-accent bg-selection' : 'border-transparent',
        // Every valid destination is visible while a card is in the air; the
        // column it came from is not a destination worth pointing at.
        dragActive && !over && !isSource && 'border-dashed border-line-strong',
      )}
    >
      <header className="flex h-9 items-center gap-2 px-3">
        <Icon className={cn('size-3.5 shrink-0', iconTone)} aria-hidden />
        <h2 className="min-w-0 truncate text-sm font-medium text-ink">{column.label}</h2>
        <span className="text-xs text-subtle tabular-nums">{tasks.length}</span>
      </header>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2 scroll-thin">
        {shown.length === 0 ? (
          <p className={cn('px-1 py-6 text-center text-xs', over ? 'text-accent' : 'text-subtle')}>
            {over ? t('dropHere') : t('columnEmpty', { label: column.label })}
          </p>
        ) : (
          shown.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              columns={columns}
              href={taskHref(task.project || slug || '', task.id, from ? { from } : undefined)}
              onMove={onMove}
              onOpen={onOpen}
              readOnly={readOnly}
              showRepository={showRepository}
              showProject={showProject}
              projectName={projectNames[task.project]}
            />
          ))
        )}
        {tasks.length > shown.length ? (
          <p className="px-1 pb-1 text-center text-2xs text-subtle">{t('moreHidden', { count: tasks.length - shown.length })}</p>
        ) : null}
      </div>
    </section>
  )
}

export function BoardEmpty() {
  const { t } = useTranslation('tasks')
  return <Empty title={t('emptyFilters')} hint={t('emptyFiltersHint')} />
}
