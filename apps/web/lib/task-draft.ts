// Kick-create stores this title. Must match TASK_DRAFT_TITLE / TASK_DRAFT_TITLES
// in portta-core — the browser bundle cannot import that package.

export const TASK_DRAFT_TITLE = 'New task'
const DRAFT_TITLES = ['New task', 'Nova tarefa'] as const

export function isDefaultDraftTitle(title: string): boolean {
  return (DRAFT_TITLES as readonly string[]).includes(title.trim())
}
