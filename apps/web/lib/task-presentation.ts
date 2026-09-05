// How a task looks, decided once.
//
// The browser must not import portta-core (its index pulls node:fs), so the
// catalogues are repeated here and must stay in step with TASK_STATUS_CATALOG,
// TASK_PRIORITIES and TASK_TYPE_CATALOG in packages/core/src/tasks.ts.
//
// Everything that gives a task a colour, an icon or an order goes through this
// module. A component that decides for itself is how the same task ends up
// amber on the board and grey in the table.

import {
  ArrowDown,
  ArrowUp,
  BookText,
  Bug,
  ChevronsUp,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Eye,
  Equal,
  Microscope,
  OctagonX,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { TaskPriority, TaskStatus, TaskSyncState } from 'portta-contracts'

/** What a board column needs to say: which status it holds. */
export interface ColumnLike {
  status: TaskStatus | null
}

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'accent' | 'agent' | 'outline'

interface StatusPresentation {
  tone: Tone
  icon: LucideIcon
  /** Started work is what a dashboard leads with; terminal work is what it hides. */
  category: 'unstarted' | 'started' | 'blocked' | 'done'
}

const STATUS: Record<TaskStatus, StatusPresentation> = {
  backlog: { tone: 'neutral', icon: CircleDashed, category: 'unstarted' },
  ready: { tone: 'outline', icon: CircleDot, category: 'unstarted' },
  in_progress: { tone: 'info', icon: CircleDot, category: 'started' },
  review: { tone: 'accent', icon: Eye, category: 'started' },
  blocked: { tone: 'danger', icon: OctagonX, category: 'blocked' },
  done: { tone: 'ok', icon: CircleCheck, category: 'done' },
}

function statusOf(status: TaskStatus | string | null | undefined): StatusPresentation | null {
  return status ? STATUS[status as TaskStatus] ?? null : null
}

export function statusTone(status: TaskStatus | string | null | undefined): Tone {
  return statusOf(status)?.tone ?? 'neutral'
}

export function statusIcon(status: TaskStatus | string | null | undefined): LucideIcon {
  return statusOf(status)?.icon ?? CircleDashed
}

export function statusCategory(status: TaskStatus | string | null | undefined): StatusPresentation['category'] {
  return statusOf(status)?.category ?? 'unstarted'
}

interface PriorityPresentation {
  tone: Tone
  icon: LucideIcon
  /** Higher sorts first. Absent priority is 0, below every stated one. */
  rank: number
}

const PRIORITY: Record<TaskPriority, PriorityPresentation> = {
  low: { tone: 'neutral', icon: ArrowDown, rank: 1 },
  medium: { tone: 'info', icon: Equal, rank: 2 },
  high: { tone: 'warn', icon: ArrowUp, rank: 3 },
  urgent: { tone: 'danger', icon: ChevronsUp, rank: 4 },
}

function priorityOf(priority: TaskPriority | string | null | undefined): PriorityPresentation | null {
  return priority ? PRIORITY[priority as TaskPriority] ?? null : null
}

export function priorityTone(priority: TaskPriority | string | null | undefined): Tone {
  return priorityOf(priority)?.tone ?? 'neutral'
}

export function priorityIcon(priority: TaskPriority | string | null | undefined): LucideIcon | null {
  return priorityOf(priority)?.icon ?? null
}

export function priorityRank(priority: TaskPriority | string | null | undefined): number {
  return priorityOf(priority)?.rank ?? 0
}

/** Mirrors TASK_TYPE_CATALOG. A type outside it still renders, in neutral. */
const TYPE: Record<string, { tone: Tone; icon: LucideIcon; aliases: readonly string[] }> = {
  feature: { tone: 'accent', icon: Sparkles, aliases: ['feat', 'features', 'enhancement-request', 'story'] },
  bug: { tone: 'danger', icon: Bug, aliases: ['fix', 'bugfix', 'defect', 'regression'] },
  improvement: { tone: 'info', icon: ArrowUp, aliases: ['enhancement', 'refactor', 'perf', 'performance'] },
  chore: { tone: 'neutral', icon: Wrench, aliases: ['task', 'maintenance', 'build', 'ci', 'deps'] },
  research: { tone: 'agent', icon: Microscope, aliases: ['spike', 'investigation', 'discovery'] },
  documentation: { tone: 'outline', icon: BookText, aliases: ['docs', 'doc'] },
}

export const TASK_TYPE_IDS = Object.keys(TYPE)

/**
 * The catalogued type a stored value means. Never rewrites it: a task typed
 * "spike" keeps saying "spike", and is coloured the way research is coloured.
 */
export function taskTypeOf(raw: string | null | undefined): string | null {
  if (!raw) return null
  const needle = raw.trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (needle === '') return null
  if (TYPE[needle]) return needle
  for (const [id, entry] of Object.entries(TYPE)) if (entry.aliases.includes(needle)) return id
  return null
}

export function typeTone(raw: string | null | undefined): Tone {
  const known = taskTypeOf(raw)
  return known ? TYPE[known]!.tone : 'neutral'
}

export function typeIcon(raw: string | null | undefined): LucideIcon | null {
  const known = taskTypeOf(raw)
  return known ? TYPE[known]!.icon : null
}

export function syncTone(state: TaskSyncState | null | undefined): Tone {
  switch (state) {
    case 'synced':
      return 'ok'
    case 'pending':
      return 'warn'
    case 'conflict':
    case 'error':
      return 'danger'
    default:
      return 'neutral'
  }
}

/**
 * A label's colour, derived from its own text.
 *
 * Labels are free text with no colour of their own here, so the alternative to
 * this is every label being the same grey. A stable hash gives each name one
 * hue it keeps everywhere, which is what makes a label recognisable in a list
 * without reading it.
 */
export function labelHue(label: string): number {
  let hash = 0
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) % 360_000
  }
  return hash % 360
}

/** A task with no status, or one no column claims, lands in the first column. */
export function columnFor<C extends ColumnLike>(task: { status: TaskStatus | null }, columns: readonly C[]): C {
  return columns.find((column) => column.status === task.status) ?? columns[0]!
}
