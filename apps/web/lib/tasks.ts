'use client'

// The rules of the task views: nesting, addressing, and filters in the hash.

import type { TaskSummary } from 'portta-contracts'
import { taskTypeOf } from './task-presentation.ts'

export const TASK_VIEWS = ['board', 'table'] as const
export type TaskView = (typeof TASK_VIEWS)[number]

export const TASK_FILTERS = ['project', 'status', 'assignee', 'repository', 'priority', 'type', 'label', 'q'] as const
export type TaskFilterKey = (typeof TASK_FILTERS)[number]
export type TaskFilterValues = Partial<Record<TaskFilterKey, string>>

/** Where a list of tasks lives: one project, or every project on the panel. */
export type TasksScopeArg = string | { project: string } | { global: true }

export function resolveTaskView(requested: string | null | undefined): TaskView {
  // "list" is what the simplified list called itself before it became a table;
  // links and bookmarks with it still land somewhere sensible.
  return requested === 'table' || requested === 'list' ? 'table' : 'board'
}

export function taskHref(slug: string, id: string, options?: { from?: 'tasks' }): string {
  const query = options?.from === 'tasks' ? '?from=tasks' : ''
  return `/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(id)}${query}`
}

function tasksPath(scope: TasksScopeArg): string {
  if (typeof scope === 'string') return `/projects/${encodeURIComponent(scope)}/tasks`
  if ('global' in scope) return '/tasks'
  return `/projects/${encodeURIComponent(scope.project)}/tasks`
}

function tasksQuery(view: TaskView, filters: TaskFilterValues): string {
  const query = new URLSearchParams()
  if (view !== 'board') query.set('view', view)
  for (const key of TASK_FILTERS) {
    const value = filters[key]
    if (value) query.set(key, value)
  }
  const suffix = query.toString()
  return suffix ? `?${suffix}` : ''
}

/** The list's own address: a filtered board is a link somebody can paste. */
export function tasksHref(scope: TasksScopeArg, view: TaskView, filters: TaskFilterValues = {}): string {
  return `${tasksPath(scope)}${tasksQuery(view, filters)}`
}

export function taskFiltersFrom(params: URLSearchParams | Record<string, string>): TaskFilterValues {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : params[key]) ?? ''
  const filters: TaskFilterValues = {}
  for (const key of TASK_FILTERS) {
    const value = get(key)
    if (value) filters[key] = value
  }
  return filters
}

/** Where the old board hash goes: same project, same filters, the tasks tab. */
export function boardToTasksHref(slug: string, legacyView: string | null, query: string): string {
  const params = new URLSearchParams(query.replace(/^\?/, ''))
  const filters = taskFiltersFrom(params)
  return tasksHref(slug, legacyView === 'backlog' ? 'table' : 'board', filters)
}

const RETURN_KEY = 'portta-tasks-return'

/** Remember the list a task was opened from, so closing it lands in the same filters. */
export function rememberTasksReturn(href: string): void {
  try {
    const main = document.querySelector('main')
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({
      href,
      scroll: main instanceof HTMLElement ? main.scrollTop : 0,
    }))
  } catch {
    /* private browsing */
  }
}

export function readTasksReturn(): { href: string; scroll: number } | null {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { href?: unknown; scroll?: unknown }
    if (typeof parsed.href !== 'string' || parsed.href === '') return null
    return { href: parsed.href, scroll: typeof parsed.scroll === 'number' ? parsed.scroll : 0 }
  } catch {
    return null
  }
}

/** The list to go back to: the remembered hash, or the fallback for this page. */
export function tasksReturnHref(from: string | null | undefined, fallback: string): string {
  if (from === 'tasks') {
    const stored = readTasksReturn()
    if (stored?.href.startsWith('/tasks')) return stored.href
    return '/tasks'
  }
  return fallback
}

export function restoreTasksScroll(): void {
  const stored = readTasksReturn()
  if (!stored || stored.scroll <= 0) return
  requestAnimationFrame(() => {
    const main = document.querySelector('main')
    if (main instanceof HTMLElement) main.scrollTop = stored.scroll
  })
}

export interface NestedTask {
  task: TaskSummary
  depth: number
}

/** Parents before children, children indented, never deeper than four. */
export function nestTasks(tasks: readonly TaskSummary[]): NestedTask[] {
  const byParent = new Map<string | null, TaskSummary[]>()
  const ids = new Set(tasks.map((task) => task.id))
  for (const task of tasks) {
    const parent = task.parentId !== null && ids.has(task.parentId) ? task.parentId : null
    const list = byParent.get(parent) ?? []
    list.push(task)
    byParent.set(parent, list)
  }
  const rows: NestedTask[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const task of byParent.get(parent) ?? []) {
      if (seen.has(task.id)) continue
      seen.add(task.id)
      rows.push({ task, depth })
      if (depth < 4) walk(task.id, depth + 1)
    }
  }
  walk(null, 0)
  for (const task of tasks) if (!seen.has(task.id)) rows.push({ task, depth: 0 })
  return rows
}

/** Client-side narrowing for filters the server does not take, or before it answers. */
export function matchesFilters(task: TaskSummary, filters: TaskFilterValues): boolean {
  if (filters.project && !filters.project.split(',').includes(task.project)) return false
  if (filters.status && !filters.status.split(',').includes(task.status)) return false
  if (filters.assignee && task.assignee !== filters.assignee && task.agent !== filters.assignee) return false
  if (filters.repository && task.repository?.id !== filters.repository) return false
  if (filters.priority && task.priority !== filters.priority) return false
  // Type is free text, so a filter matches the value or the vocabulary entry it
  // belongs to: picking "improvement" also finds the tasks typed "refactor".
  if (filters.type && task.type !== filters.type && taskTypeOf(task.type) !== filters.type) return false
  if (filters.label && !task.labels.includes(filters.label)) return false
  if (filters.q) {
    const needle = filters.q.toLowerCase()
    const haystack = `#${task.id} ${task.title} ${task.labels.join(' ')} ${task.github ? `${task.github.repository}#${task.github.number}` : ''}`.toLowerCase()
    if (!haystack.includes(needle)) return false
  }
  return true
}

/** Every label in a set of tasks, once, in the order a filter should offer them. */
export function labelsOf(tasks: readonly TaskSummary[]): string[] {
  return [...new Set(tasks.flatMap((task) => task.labels))].sort((left, right) => left.localeCompare(right))
}

/** Every type in a set of tasks, once, whether or not the vocabulary knows it. */
export function typesOf(tasks: readonly TaskSummary[]): string[] {
  return [...new Set(tasks.flatMap((task) => (task.type ? [task.type] : [])))]
    .sort((left, right) => left.localeCompare(right))
}

/** Who is on it: the agent when one is, else the person. */
export function taskWorker(task: Pick<TaskSummary, 'assignee' | 'agent'>): { name: string; kind: 'agent' | 'human' } | null {
  if (task.agent) return { name: task.agent, kind: 'agent' }
  if (task.assignee) return { name: task.assignee, kind: 'human' }
  return null
}

/** The name a person recognises, falling back to the slug the API already has. */
export function projectNameOf(slug: string, names: Record<string, string> = {}): string {
  return names[slug] ?? slug
}
