'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Columns3, Table2, X } from 'lucide-react'
import { api, ApiError } from '../../lib/api/index.ts'
import { keys, useProject, useTasksList } from '../../lib/queries/index.ts'
import type { Project, ProjectSummary, TaskStatus, TaskSummary } from 'portta-contracts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Card } from '../ui/card.tsx'
import { Segmented } from '../ui/segmented.tsx'
import { useToast } from '../ui/toast.tsx'
import { ColumnsMenu, useTableArrangement } from '../ui/table-arrangement.tsx'
import { Empty, ErrorBox, Loading, ToolbarSearch, ToolbarSelect, ViewToolbar } from '../shell-bits.tsx'
import { useOptimisticMutation } from '../../lib/optimistic.ts'
import { useRouter } from 'next/navigation'
import {
  labelsOf,
  matchesFilters,
  rememberTasksReturn,
  tasksHref,
  typesOf,
  type TaskFilterValues,
  type TaskView,
} from '../../lib/tasks.ts'
import { useBoardColumns, useTaskStatuses } from '@/lib/i18n/use-task-statuses.ts'
import { BoardEmpty, TaskBoard } from './task-board.tsx'
import { TaskTable } from './task-table.tsx'

export type TasksScope =
  | { kind: 'project'; project: Project }
  | { kind: 'global'; projects: ProjectSummary[] }

/**
 * One board or one table over the same rows. The project tab and the global
 * page differ only in the query they ask and the extra project column.
 */
export function TasksView({
  scope,
  view,
  filters,
  readOnly = false,
  initialTasks,
}: {
  scope: TasksScope
  view: TaskView
  filters: TaskFilterValues
  readOnly?: boolean
  /** What the server read for this render, so the board is there on first paint. */
  initialTasks?: TaskSummary[]
}) {
  const { t } = useTranslation('tasks')
  const { statusOptions, priorityOptions } = useTaskStatuses()
  const boardColumns = useBoardColumns()
  const toast = useToast()
  const router = useRouter()
  const [failure, setFailure] = useState<unknown>(null)

  const slug = scope.kind === 'project' ? scope.project.slug : null
  const from = scope.kind === 'global' ? 'tasks' as const : undefined
  const listHref = tasksHref(scope.kind === 'global' ? { global: true } : slug!, view, filters)

  useEffect(() => {
    rememberTasksReturn(listHref)
  }, [listHref])

  const selectedSlug = scope.kind === 'global' ? (filters.project ?? '') : ''
  const selected = useProject(selectedSlug, selectedSlug !== '')

  // The board wants every open task; the table is the place to look at what is
  // already done, so it asks for everything.
  const serverFilters = view === 'table' ? {} : { open: 'true' }
  const query = useTasksList(slug, serverFilters, true, initialTasks)
  const queryKey = slug ? keys.tasks(slug, serverFilters) : keys.allTasks(serverFilters)

  const move = useOptimisticMutation<unknown, { task: TaskSummary; status: TaskStatus; beforeId: string | null; afterId: string | null }, TaskSummary[]>({
    queryKey,
    mutationFn: ({ task, status, beforeId, afterId }) => api.moveTask(task.id, { status, beforeId, afterId }),
    update: (current, { task, status, beforeId, afterId }) => {
      if (!current) return current
      const without = current.filter((entry) => entry.id !== task.id)
      const destination = without.filter((entry) => entry.status === status).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      const afterIndex = afterId ? destination.findIndex((entry) => entry.id === afterId) : -1
      const beforeIndex = beforeId ? destination.findIndex((entry) => entry.id === beforeId) : -1
      const index = afterIndex >= 0 ? afterIndex : beforeIndex >= 0 ? beforeIndex + 1 : destination.length
      destination.splice(index, 0, { ...task, status })
      const ranks = new Map(destination.map((entry, rank) => [entry.id, (rank + 1) * 1024]))
      return [...without, { ...task, status }].map((entry) => ranks.has(entry.id) ? { ...entry, status, position: ranks.get(entry.id)! } : entry)
    },
    // The card is already back where it started by the time this runs; the
    // toast is what tells the operator that, rather than the card twitching.
    onFailure: (error, { task }) => {
      setFailure(error)
      toast.push({
        tone: 'danger',
        title: t('moveFailed', { id: task.id }),
        description: error instanceof ApiError
          ? [error.message, error.hint].filter(Boolean).join(' · ')
          : t('moveFailedHint'),
      })
    },
  })

  const all = query.data ?? []
  const shown = useMemo(() => all.filter((task) => matchesFilters(task, filters)), [all, filters])
  const labels = useMemo(() => labelsOf(all), [all])
  const types = useMemo(() => typesOf(all), [all])
  const activeFilters = Object.values(filters).filter(Boolean).length
  const projectNames = useMemo(() => {
    const names: Record<string, string> = {}
    if (scope.kind === 'project') {
      names[scope.project.slug] = scope.project.name
      return names
    }
    for (const project of scope.projects) names[project.slug] = project.name
    return names
  }, [scope])

  const repositories = scope.kind === 'project'
    ? scope.project.repositories
    : (selected.data?.repositories ?? [])
  const showRepository = scope.kind === 'project'
    ? scope.project.repositories.length > 1
    : new Set(shown.map((task) => task.repository?.id).filter(Boolean)).size > 1

  const unavailable = query.error instanceof ApiError && query.error.status === 503
  const setFilter = (key: keyof TaskFilterValues, value: string) =>
    router.push(tasksHref(scope.kind === 'global' ? { global: true } : slug!, view, { ...filters, [key]: value === '' ? undefined : value }))
  const setView = (next: TaskView) => router.push(tasksHref(scope.kind === 'global' ? { global: true } : slug!, next, filters))
  const clearHref = tasksHref(scope.kind === 'global' ? { global: true } : slug!, view)

  // Which columns the table shows is the page's to hold: the menu that
  // changes it sits in the row above, beside the switcher.
  const table = useTableArrangement(scope.kind === 'global' ? 'tasks-all' : 'tasks')

  const setStatus = (task: TaskSummary, status: TaskStatus) => {
    setFailure(null)
    move.mutate({ task, status, beforeId: null, afterId: null })
  }

  const controls = (
    <>
      {scope.kind === 'global' ? (
        <ToolbarSelect width="lg" value={filters.project ?? ''} onChange={(event) => setFilter('project', event.target.value)} aria-label={t('projectFilter')}>
          <option value="">{t('allProjects')}</option>
          {scope.projects.filter((project) => !project.archived).map((project) => (
            <option key={project.slug} value={project.slug}>{project.name}</option>
          ))}
        </ToolbarSelect>
      ) : null}
      <ToolbarSearch
        value={filters.q ?? ''}
        onChange={(event) => setFilter('q', event.target.value)}
        placeholder={t('filterPlaceholder')}
        aria-label={t('filterAria')}
      />
      <ToolbarSelect value={filters.status ?? ''} onChange={(event) => setFilter('status', event.target.value)} aria-label={t('statusFilter')}>
        <option value="">{t('anyStatus')}</option>
        {statusOptions.map((entry) => (
          <option key={entry.value} value={entry.value}>{entry.label}</option>
        ))}
      </ToolbarSelect>
      <ToolbarSelect width="lg" value={filters.priority ?? ''} onChange={(event) => setFilter('priority', event.target.value)} aria-label={t('priorityFilter')}>
        <option value="">{t('anyPriority')}</option>
        {priorityOptions.filter((entry) => entry.value !== '').map((entry) => (
          <option key={entry.value} value={entry.value}>{entry.label}</option>
        ))}
      </ToolbarSelect>
      {types.length > 0 ? (
        <ToolbarSelect value={filters.type ?? ''} onChange={(event) => setFilter('type', event.target.value)} className="hidden lg:inline-block" aria-label={t('typeFilter')}>
          <option value="">{t('anyType')}</option>
          {types.map((type) => <option key={type} value={type}>{type}</option>)}
        </ToolbarSelect>
      ) : null}
      {labels.length > 0 ? (
        <ToolbarSelect value={filters.label ?? ''} onChange={(event) => setFilter('label', event.target.value)} className="hidden lg:inline-block" aria-label={t('labelFilter')}>
          <option value="">{t('anyLabel')}</option>
          {labels.map((label) => <option key={label} value={label}>{label}</option>)}
        </ToolbarSelect>
      ) : null}
      {repositories.length > 0 ? (
        <ToolbarSelect width="lg" value={filters.repository ?? ''} onChange={(event) => setFilter('repository', event.target.value)} className="hidden xl:inline-block" aria-label={t('repositoryFilter')}>
          <option value="">{t('anyRepository')}</option>
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>{repository.name}</option>
          ))}
        </ToolbarSelect>
      ) : null}
      {activeFilters > 0 ? (
        <Button size="sm" variant="ghost" onClick={() => router.push(clearHref)}>
          <X />
          {t('clearFilters')}
        </Button>
      ) : null}
    </>
  )

  const switcher = (
    <Segmented
      label={t('viewLabel')}
      value={view}
      onChange={setView}
      options={[
        { value: 'board', label: t('views.board'), icon: Columns3 },
        { value: 'table', label: t('views.table'), icon: Table2 },
      ]}
    />
  )
  const chrome = (
    <ViewToolbar
      switcher={switcher}
      trailing={
        <>
          {view === 'table' ? <ColumnsMenu arrangement={table} /> : null}
          {readOnly ? <Badge tone="outline">{t('readOnly')}</Badge> : null}
        </>
      }
    >
      {controls}
    </ViewToolbar>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {chrome}

      {failure ? (
        <div className="mb-3">
          <ErrorBox error={failure} />
        </div>
      ) : null}

      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        unavailable ? (
          <Card><Empty title={t('needsDatabase')} hint={t('needsDatabaseHint')} /></Card>
        ) : (
          <ErrorBox error={query.error} />
        )
      ) : view === 'table' ? (
        <Card>
          <TaskTable
            slug={slug ?? undefined}
            tasks={shown}
            columns={boardColumns}
            readOnly={readOnly}
            onSetStatus={readOnly ? undefined : setStatus}
            arrangement={table}
            empty={<BoardEmpty />}
            showProject={scope.kind === 'global'}
            projectNames={projectNames}
            from={from}
          />
        </Card>
      ) : shown.length === 0 ? (
        <Card><BoardEmpty /></Card>
      ) : (
        <TaskBoard
          slug={slug ?? undefined}
          tasks={shown}
          columns={boardColumns}
          readOnly={readOnly}
          showRepository={showRepository}
          showProject={scope.kind === 'global'}
          projectNames={projectNames}
          from={from}
          onMove={(task, status, beforeId, afterId) => {
            setFailure(null)
            move.mutate({ task, status, beforeId, afterId })
          }}
        />
      )}
    </div>
  )
}

/** The project tab still imports this name. */
export function TasksTab({
  project,
  view,
  filters,
  readOnly = false,
  initialTasks,
}: {
  project: Project
  view: TaskView
  filters: TaskFilterValues
  readOnly?: boolean
  initialTasks?: TaskSummary[]
}) {
  return (
    <TasksView
      scope={{ kind: 'project', project }}
      view={view}
      filters={filters}
      readOnly={readOnly}
      {...(initialTasks ? { initialTasks } : {})}
    />
  )
}
