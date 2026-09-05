'use client'

import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal } from 'lucide-react'
import type { TaskStatus, TaskSummary } from 'portta-contracts'
import { useTaskStatuses, type BoardColumn } from '@/lib/i18n/use-task-statuses.ts'
import { priorityRank, statusCategory } from '../../lib/task-presentation.ts'
import { nestTasks, projectNameOf, taskHref } from '../../lib/tasks.ts'
import { useFormat } from '../../lib/use-format.ts'
import type { Column } from '../../lib/table.ts'
import { DataTable } from '../ui/data-table.tsx'
import type { TableArrangementHandle } from '../ui/table-arrangement.tsx'
import { Button } from '../ui/button.tsx'
import { NoValue } from '../shell-bits.tsx'
import { navigate } from '../../lib/navigation.ts'
import { Mono } from '../copy.tsx'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui/menu.tsx'
import { TaskGitHubBadge, TaskLabels, TaskPriorityBadge, TaskStatusBadge, TaskTypeBadge, TaskWorker } from '../entities/task-badges.tsx'

/**
 * Tasks as a table.
 *
 * This replaces the "list" view, which was the board's cards unwrapped into
 * one line each: the same information, in the same order, with none of the
 * comparison a list is for. A table lets a person sort by priority, see what
 * has not moved in a week, and change a status without opening anything —
 * which is what the board cannot do across more than one column at a time.
 *
 * Order still comes from `nestTasks` by default, so a subtask stays under its
 * parent; sorting by a column is what breaks that, deliberately, because
 * "everything urgent" is not a tree.
 */
export function TaskTable({
  slug,
  tasks,
  columns: boardColumns,
  onSetStatus,
  onOpen,
  readOnly = false,
  arrangement,
  empty,
  showProject = false,
  projectNames = {},
  from,
}: {
  slug?: string
  tasks: TaskSummary[]
  columns: BoardColumn[]
  onSetStatus?: (task: TaskSummary, status: TaskStatus) => void
  onOpen?: (task: TaskSummary) => void
  readOnly?: boolean
  /** Held by the page, so the column menu can sit in its toolbar. */
  arrangement?: TableArrangementHandle
  empty?: ReactNode
  showProject?: boolean
  projectNames?: Record<string, string>
  from?: 'tasks'
}) {
  const { t } = useTranslation('tasks')
  const { t: tc } = useTranslation('common')
  const { statusLabel, priorityLabel } = useTaskStatuses()
  const { relativeTime } = useFormat()

  // Parents before children, so the natural order of the table is the tree.
  const rows = useMemo(() => nestTasks(tasks).map(({ task, depth }) => ({ task, depth })), [tasks])

  const columns = useMemo<Column<{ task: TaskSummary; depth: number }>[]>(() => [
    {
      id: 'id',
      header: t('table.id'),
      pinned: true,
      sortValue: ({ task }) => Number(task.id) || task.id,
      cell: ({ task }) => (
        <a className="rounded-xs underline-offset-2 hover:underline focus-ring" href={taskHref(slug ?? task.project, task.id, from ? { from } : undefined)}>
          <Mono kind="id" tone="subtle" className="text-xs">#{task.id}</Mono>
        </a>
      ),
    },
    {
      id: 'title',
      header: t('table.title'),
      pinned: true,
      sortValue: ({ task }) => task.title,
      cell: ({ task, depth }) => (
        <a
          className="block max-w-104 truncate rounded-xs text-sm text-ink underline-offset-2 hover:underline focus-ring"
          style={{ paddingLeft: `${depth * 16}px` }}
          href={taskHref(slug ?? task.project, task.id, from ? { from } : undefined)}
          title={task.title}
        >
          {task.title}
        </a>
      ),
    },
    ...(showProject
      ? [{
          id: 'project',
          header: t('table.project'),
          sortValue: ({ task }: { task: TaskSummary }) => projectNameOf(task.project, projectNames),
          cell: ({ task }: { task: TaskSummary }) => (
            <a className="rounded-xs text-xs text-subtle underline-offset-2 hover:text-ink hover:underline focus-ring" href={`/projects/${encodeURIComponent(task.project)}`}>
              {projectNameOf(task.project, projectNames)}
            </a>
          ),
        } as Column<{ task: TaskSummary; depth: number }>]
      : []),
    {
      id: 'status',
      header: t('table.status'),
      // Started work first, then blocked, then what has not begun: the order a
      // board reads left to right.
      sortValue: ({ task }) => `${statusCategory(task.status)}:${task.status}`,
      cell: ({ task }) => <TaskStatusBadge status={task.status} />,
    },
    {
      id: 'priority',
      header: t('table.priority'),
      sortValue: ({ task }) => priorityRank(task.priority),
      cell: ({ task }) => (task.priority ? <TaskPriorityBadge priority={task.priority} /> : <NoValue />),
    },
    {
      id: 'type',
      header: t('table.type'),
      priority: 2,
      sortValue: ({ task }) => task.type,
      cell: ({ task }) => (task.type ? <TaskTypeBadge type={task.type} /> : <NoValue />),
    },
    {
      id: 'labels',
      header: t('table.labels'),
      priority: 3,
      defaultHidden: true,
      sortValue: ({ task }) => task.labels.join(','),
      cell: ({ task }) => (task.labels.length > 0 ? <TaskLabels labels={task.labels} max={2} /> : <NoValue />),
    },
    {
      id: 'repository',
      header: t('table.repository'),
      priority: 2,
      sortValue: ({ task }) => task.repository?.name ?? null,
      cell: ({ task }) => (task.repository ? <span className="text-xs text-muted">{task.repository.name}</span> : <NoValue />),
    },
    {
      id: 'worker',
      header: t('table.worker'),
      sortValue: ({ task }) => task.agent ?? task.assignee,
      cell: ({ task }) => (task.agent || task.assignee ? <TaskWorker task={task} /> : <NoValue />),
    },
    {
      id: 'github',
      header: t('table.github'),
      priority: 3,
      defaultHidden: true,
      sortValue: ({ task }) => task.github?.number ?? null,
      cell: ({ task }) => (task.github ? <TaskGitHubBadge github={task.github} /> : <NoValue />),
    },
    {
      id: 'due',
      header: t('table.due'),
      priority: 3,
      defaultHidden: true,
      sortValue: ({ task }) => task.dueAt,
      cell: ({ task }) => (task.dueAt ? <span className="text-xs tabular-nums">{relativeTime(task.dueAt)}</span> : <NoValue />),
    },
    {
      id: 'updated',
      header: t('table.updated'),
      align: 'right',
      priority: 2,
      sortValue: ({ task }) => task.updatedAt,
      cell: ({ task }) => <span className="text-xs text-subtle tabular-nums">{relativeTime(task.updatedAt)}</span>,
    },
    {
      id: 'actions',
      header: '',
      srHeader: t('table.actions'),
      pinned: true,
      align: 'right',
      cell: ({ task }) => (
        <div className="flex justify-end row-actions">
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('actionsFor', { id: task.id })}>
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => (onOpen ? onOpen(task) : navigateTo(taskHref(slug ?? task.project, task.id, from ? { from } : undefined)))}>
                {tc('open')}
              </MenuItem>
              {onSetStatus ? (
                <>
                  <MenuSeparator />
                  <MenuLabel>{t('table.status')}</MenuLabel>
                  {boardColumns.map((column) => (
                    <MenuItem
                      key={column.id}
                      disabled={readOnly || task.status === column.status}
                      onSelect={() => onSetStatus(task, column.status)}
                    >
                      {t('moveTo', { label: column.label })}
                    </MenuItem>
                  ))}
                </>
              ) : null}
            </MenuContent>
          </Menu>
        </div>
      ),
    },
  ], [boardColumns, from, onOpen, onSetStatus, priorityLabel, projectNames, readOnly, relativeTime, showProject, slug, statusLabel, t, tc])

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={({ task }) => task.id}
      rowLabel={({ task }) => `#${task.id} ${task.title}`}
      storageKey={showProject ? 'tasks-all' : 'tasks'}
      arrangement={arrangement}
      caption={t('table.caption')}
      empty={empty}
    />
  )
}

function navigateTo(href: string): void {
  navigate(href)
}
