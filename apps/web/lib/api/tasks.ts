// Work: Portta's own tasks, and the optional GitHub binding on top of them.

import type { Task, TaskAttachment, TaskSummary } from 'portta-contracts'
import { request } from './client.ts'

export type TaskFilters = Partial<Record<'status' | 'open' | 'priority' | 'type' | 'label' | 'assignee' | 'agent' | 'repository' | 'environment' | 'service' | 'parent' | 'project' | 'q', string>>

export interface TaskBody {
  title?: string
  description?: string | null
  status?: string
  priority?: string | null
  type?: string | null
  labels?: string[]
  assignee?: string | null
  agent?: string | null
  parentId?: string | null
  repositoryId?: string | null
  environment?: string | null
  service?: string | null
  dueAt?: number | null
  draft?: boolean
  position?: number
}

export interface SubtaskNode {
  task: TaskSummary
  children: SubtaskNode[]
}

function query(filters: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
  const suffix = params.toString()
  return suffix ? `?${suffix}` : ''
}

const ref = (value: string) => encodeURIComponent(value)
const slugOf = (value: string) => encodeURIComponent(value)

export const tasksApi = {
  tasks: (slug: string, filters: TaskFilters = {}) =>
    request<{ tasks: TaskSummary[] }>(`/projects/${slugOf(slug)}/tasks${query(filters)}`).then((data) => data.tasks),
  allTasks: (filters: TaskFilters = {}) =>
    request<{ tasks: TaskSummary[] }>(`/tasks${query(filters)}`).then((data) => data.tasks),
  nextTask: (slug: string) =>
    request<{ task: TaskSummary | null }>(`/projects/${slugOf(slug)}/tasks/next`).then((data) => data.task),
  createTask: (slug: string, body: TaskBody) =>
    request<Task>(`/projects/${slugOf(slug)}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  task: (id: string) => request<Task>(`/tasks/${ref(id)}`),
  patchTask: (id: string, body: TaskBody) =>
    request<Task>(`/tasks/${ref(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  moveTask: (id: string, body: { status: string; beforeId?: string | null; afterId?: string | null }) =>
    request<Task>(`/tasks/${ref(id)}/move`, { method: 'POST', body: JSON.stringify(body) }),
  deleteTask: (id: string) => request<{ ok: boolean }>(`/tasks/${ref(id)}`, { method: 'DELETE', body: '{}' }),
  taskSubtasks: (id: string) =>
    request<{ subtasks: SubtaskNode[] }>(`/tasks/${ref(id)}/subtasks`).then((data) => data.subtasks),
  taskNotes: (id: string) => request<{ notes: Task['notes'] }>(`/tasks/${ref(id)}/notes`).then((data) => data.notes),
  taskComments: (id: string) => request<{ comments: Task['notes'] }>(`/tasks/${ref(id)}/comments`).then((data) => data.comments),
  addTaskNote: (id: string, body: string) =>
    request<Task['notes'][number]>(`/tasks/${ref(id)}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
  updateTaskNote: (id: string, noteId: string, body: string) =>
    request<Task['notes'][number]>(`/tasks/${ref(id)}/notes/${ref(noteId)}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteTaskNote: (id: string, noteId: string) =>
    request<{ ok: boolean }>(`/tasks/${ref(id)}/notes/${ref(noteId)}`, { method: 'DELETE', body: '{}' }),
  addTaskComment: (id: string, body: string) =>
    request<Task['notes'][number]>(`/tasks/${ref(id)}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  updateTaskComment: (id: string, commentId: string, body: string) =>
    request<Task['notes'][number]>(`/tasks/${ref(id)}/comments/${ref(commentId)}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteTaskComment: (id: string, commentId: string) =>
    request<{ ok: boolean }>(`/tasks/${ref(id)}/comments/${ref(commentId)}`, { method: 'DELETE', body: '{}' }),
  publishTaskCommentGitHub: (id: string, commentId: string) =>
    request<Task['notes'][number]>(`/tasks/${ref(id)}/comments/${ref(commentId)}/github/publish`, { method: 'POST', body: '{}' }),
  importProjectTasks: (slug: string, document: unknown) =>
    request<{ project: string; created: number; updated: number; tasks: Task[] }>(`/projects/${slugOf(slug)}/tasks/import`, { method: 'POST', body: JSON.stringify(document) }),
  exportProjectTasks: (slug: string) =>
    request<unknown>(`/projects/${slugOf(slug)}/tasks/export`),
  startTask: (id: string, assign?: boolean) =>
    request<Task>(`/tasks/${ref(id)}/start`, { method: 'POST', body: JSON.stringify(assign === undefined ? {} : { assign }) }),
  setTaskStatus: (id: string, status: string) =>
    request<Task>(`/tasks/${ref(id)}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  finishTask: (id: string, close?: boolean) =>
    request<Task>(`/tasks/${ref(id)}/finish`, { method: 'POST', body: JSON.stringify(close === undefined ? {} : { close }) }),
  setTaskEnvironments: (id: string, environments: string[]) =>
    request<Task>(`/tasks/${ref(id)}/environments`, { method: 'PUT', body: JSON.stringify({ environments }) }),
  taskAttachments: (id: string) =>
    request<{ attachments: TaskAttachment[] }>(`/tasks/${ref(id)}/attachments`).then((data) => data.attachments),
  /**
   * Multipart rather than JSON: it is what a file input and a `curl -F` both
   * already speak, and it keeps the bytes out of a base64 round-trip.
   */
  addTaskAttachment: (id: string, file: File) => {
    const form = new FormData()
    form.set('file', file)
    form.set('filename', file.name)
    // No content-type header: the browser sets it with the multipart boundary.
    return request<TaskAttachment>(`/tasks/${ref(id)}/attachments`, { method: 'POST', body: form })
  },
  deleteTaskAttachment: (id: string, attachmentId: string) =>
    request<{ ok: boolean }>(`/tasks/${ref(id)}/attachments/${ref(attachmentId)}`, { method: 'DELETE', body: '{}' }),
  createTaskSubtask: (id: string, body: TaskBody & { title: string }) =>
    request<Task>(`/tasks/${ref(id)}/subtasks`, { method: 'POST', body: JSON.stringify(body) }),
  linkTaskSubtask: (id: string, childId: string) =>
    request<Task>(`/tasks/${ref(id)}/subtasks/${ref(childId)}`, { method: 'PUT', body: '{}' }),
  unlinkTaskSubtask: (id: string, childId: string) =>
    request<Task>(`/tasks/${ref(id)}/subtasks/${ref(childId)}`, { method: 'DELETE', body: '{}' }),
  linkTaskGitHub: (id: string, issue: string, initialSync: 'pull' | 'push') =>
    request<Task>(`/tasks/${ref(id)}/github/link`, { method: 'POST', body: JSON.stringify({ issue, initialSync }) }),
  unlinkTaskGitHub: (id: string) =>
    request<Task>(`/tasks/${ref(id)}/github/unlink`, { method: 'POST', body: '{}' }),
  publishTaskGitHub: (id: string, body: { repository?: string } = {}) =>
    request<Task>(`/tasks/${ref(id)}/github/publish`, { method: 'POST', body: JSON.stringify(body) }),
  syncTaskGitHub: (id: string, resolve?: 'local' | 'remote') =>
    request<Task>(`/tasks/${ref(id)}/github/sync`, { method: 'POST', body: JSON.stringify(resolve ? { resolve } : {}) }),
  commentTaskGitHub: (id: string, body: string) =>
    request<{ id: number; htmlUrl: string }>(`/tasks/${ref(id)}/github/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
}
