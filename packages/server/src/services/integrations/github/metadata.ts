// The one place GitHub's vocabulary becomes the panel's, and back.
//
// GitHub's native issue types and project fields are not available on every
// account, so status and priority are read through one abstraction with two
// implementations: native fields where the repository has them, a documented
// label convention where it does not. No caller knows which — but every
// response says which, because writing a status through labels means adding
// one label and removing another, and that shows in the issue's timeline.

export const WORKFLOW_STATUSES = ['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done'] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export type MetadataSource = 'fields' | 'labels' | 'none'

/** The convention, in one table and nowhere else. `kinds.ts` is the precedent. */
export const STATUS_LABELS: Record<WorkflowStatus, string> = {
  backlog: 'status:backlog',
  ready: 'status:ready',
  in_progress: 'status:in-progress',
  review: 'status:review',
  blocked: 'status:blocked',
  done: 'status:done',
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'priority:low',
  medium: 'priority:medium',
  high: 'priority:high',
  urgent: 'priority:urgent',
}

const STATUS_BY_LABEL = new Map(
  Object.entries(STATUS_LABELS).map(([status, label]) => [label, status as WorkflowStatus]),
)
const PRIORITY_BY_LABEL = new Map(
  Object.entries(PRIORITY_LABELS).map(([priority, label]) => [label, priority as Priority]),
)

export function statusFromLabels(labels: string[]): WorkflowStatus | null {
  for (const label of labels) {
    const found = STATUS_BY_LABEL.get(label.toLowerCase())
    if (found) return found
  }
  return null
}

export function priorityFromLabels(labels: string[]): Priority | null {
  for (const label of labels) {
    const found = PRIORITY_BY_LABEL.get(label.toLowerCase())
    if (found) return found
  }
  return null
}

/** Every label this convention owns, so a write can remove the stale ones. */
export function managedLabels(): Set<string> {
  return new Set([...Object.values(STATUS_LABELS), ...Object.values(PRIORITY_LABELS)])
}

export function isWorkflowStatus(value: string): value is WorkflowStatus {
  return (WORKFLOW_STATUSES as readonly string[]).includes(value)
}

export function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value)
}

/**
 * The label set an issue should carry after a status or priority change.
 *
 * Returned rather than applied, so the caller can send one `PATCH` and the
 * result can be tested without a network. Every label this convention owns is
 * removed first, so an issue never ends up carrying two statuses.
 */
export function labelsAfter(
  current: string[],
  change: { status?: WorkflowStatus | null; priority?: Priority | null },
): string[] {
  const next = current.filter((label) => {
    const lower = label.toLowerCase()
    // Only the dimension being changed is cleared, so setting a priority never
    // silently drops a status.
    if (change.status !== undefined && STATUS_BY_LABEL.has(lower)) return false
    if (change.priority !== undefined && PRIORITY_BY_LABEL.has(lower)) return false
    return true
  })

  if (change.status) next.push(STATUS_LABELS[change.status])
  if (change.priority) next.push(PRIORITY_LABELS[change.priority])
  return next
}

export interface ReadMetadata {
  status: WorkflowStatus | null
  priority: Priority | null
  source: MetadataSource
}

/**
 * Reads status and priority off one issue.
 *
 * A native issue type wins where GitHub supplies one; otherwise the labels
 * decide. `source` travels with the answer so the caller knows what a write
 * would actually do.
 */
export function readMetadata(issue: {
  labels: string[]
  issueType?: string | null
  fields?: { status?: string | null; priority?: string | null } | null
}): ReadMetadata {
  const fieldStatus = issue.fields?.status?.toLowerCase().replace(/[\s-]+/g, '_') ?? null
  const fieldPriority = issue.fields?.priority?.toLowerCase() ?? null

  if (fieldStatus !== null && isWorkflowStatus(fieldStatus)) {
    return {
      status: fieldStatus,
      priority: fieldPriority !== null && isPriority(fieldPriority) ? fieldPriority : null,
      source: 'fields',
    }
  }

  const status = statusFromLabels(issue.labels)
  const priority = priorityFromLabels(issue.labels)
  if (status === null && priority === null) return { status: null, priority: null, source: 'none' }
  return { status, priority, source: 'labels' }
}
