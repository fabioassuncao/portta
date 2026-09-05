'use client'

import { Bot, GitCommitHorizontal, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  ActivityEvent,
  Project,
  Session,
  Task,
  TaskNote,
  TaskSummary,
} from 'portta-contracts'
import type { TaskBody } from '../../lib/api/index.ts'
import { Badge } from '../ui/badge.tsx'
import { SectionHeader } from '../shell-bits.tsx'
import { Mono } from '../copy.tsx'
import { useFormat } from '../../lib/use-format.ts'
import { SessionRow } from '../entities/session-row.tsx'
import { EditableTitle } from './editable-title.tsx'
import { TaskDescription } from './task-description.tsx'
import { TaskProperties } from './task-properties.tsx'
import { TaskSubtasks } from './task-subtasks.tsx'
import { TaskActivity } from './task-activity.tsx'
import { TaskActions } from './task-actions.tsx'
import { TaskAttachments } from './task-attachments.tsx'

export interface TaskWorkspaceActions {
  uploadAttachments: (files: File[]) => void
  removeAttachment: (attachment: Task['attachments'][number]) => void
  patch: (body: TaskBody) => Promise<unknown>
  start: () => void
  finish: (close: boolean) => void
  setStatus: (status: Task['status']) => void
  addNote: (body: string) => Promise<unknown>
  editNote: (note: TaskNote, body: string) => Promise<unknown>
  deleteNote: (note: TaskNote) => void
  publishNote: (note: TaskNote) => Promise<unknown>
  createSubtask: () => void
  linkSubtask: (id: string) => void
  unlinkSubtask: (id: string) => void
  setSubtaskStatus: (id: string, status: Task['status']) => void
  discard: () => void
  github: {
    configured: boolean
    link: (issue: string, initialSync: 'pull' | 'push') => Promise<unknown>
    unlink: () => void
    publish: () => void
    sync: (resolve?: 'local' | 'remote') => void
  }
}

export function TaskWorkspace({
  task,
  project,
  sessions,
  events,
  candidates,
  parentTitle,
  actions,
  readOnly = false,
  saveState,
  uploading = false,
}: {
  task: Task
  project: Project | null
  sessions: Session[]
  events: ActivityEvent[]
  candidates: TaskSummary[]
  parentTitle?: string | null
  actions: TaskWorkspaceActions
  readOnly?: boolean
  saveState?: 'idle' | 'saving' | 'saved' | 'error'
  /** An attachment is on its way to the server. */
  uploading?: boolean
}) {
  const { t } = useTranslation('tasks')
  const { relativeTime } = useFormat()
  const commits = sessions.flatMap((session) => session.commits.map((commit) => ({ ...commit, session })))
  const activeSessions = sessions.filter((session) => session.status === 'active')

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-10">
      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* The id is the last step of the breadcrumb above; this line
                carries only what the breadcrumb cannot say, and takes no room
                when there is none. */}
            {task.draft || (saveState && saveState !== 'idle') ? (
              <div className="mb-1 flex flex-wrap items-center gap-2">
                {task.draft ? <Badge tone="outline">{t('draft.badge')}</Badge> : null}
                {saveState === 'saving' ? <span className="text-xs text-subtle">{t('save.saving')}</span> : null}
                {saveState === 'saved' ? <span className="text-xs text-subtle">{t('save.saved')}</span> : null}
                {saveState === 'error' ? <span className="text-xs text-danger">{t('save.failed')}</span> : null}
              </div>
            ) : null}
            <EditableTitle
              value={task.title}
              draft={task.draft}
              autoFocus={task.draft}
              disabled={readOnly}
              onSave={(title) => actions.patch({ title })}
            />
          </div>
          <TaskActions
            task={task}
            readOnly={readOnly}
            onSetStatus={actions.setStatus}
            onStart={actions.start}
            onFinish={actions.finish}
            onDiscard={actions.discard}
          />
        </div>

        <TaskDescription value={task.description} disabled={readOnly} onSave={(description) => actions.patch({ description })} />
        <TaskAttachments
          attachments={task.attachments}
          readOnly={readOnly}
          busy={uploading}
          onUpload={actions.uploadAttachments}
          onRemove={actions.removeAttachment}
        />

        <TaskSubtasks
          task={task}
          candidates={candidates}
          readOnly={readOnly}
          onCreate={actions.createSubtask}
          onLink={actions.linkSubtask}
          onUnlink={actions.unlinkSubtask}
          onStatus={actions.setSubtaskStatus}
        />

        {/* Who is executing this, and how execution actually starts here: an
            agent announces its own session, so the panel reports rather than
            launches. Saying so is what stops "Start" reading as "run an agent". */}
        <section className="space-y-2">
          <SectionHeader title={t('detail.sessions', { count: activeSessions.length })} />
          {sessions.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-line">
              {sessions.map((session) => <SessionRow key={session.id} session={session} />)}
            </div>
          ) : (
            <p className="text-xs text-subtle">{t('detail.executionHint', { id: task.id })}</p>
          )}
        </section>

        {task.environments.length > 0 ? (
          <section className="space-y-2">
            <SectionHeader title={t('detail.environments', { count: task.environments.length })} />
            <ul className="space-y-1 text-sm">
              {task.environments.map((link) => (
                <li key={link.environment}>
                  <a className="text-accent hover:underline" href={link.panelUrl}>{link.environment}</a>
                  <span className="ml-2 text-xs text-subtle">{link.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {commits.length > 0 ? (
          <section className="space-y-2">
            <SectionHeader title={t('detail.commits', { count: commits.length })} />
            <ul className="divide-y divide-line-subtle rounded-md border border-line">
              {commits.map((commit) => (
                <li key={`${commit.session.id}-${commit.sha}`} className="flex h-9 items-center gap-2 px-3 text-sm">
                  <GitCommitHorizontal className="size-3.5 text-subtle" aria-hidden />
                  <Mono kind="sha" tone="subtle" className="text-xs">{commit.sha.slice(0, 7)}</Mono>
                  <span className="min-w-0 truncate">{commit.subject}</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-subtle">
                    {commit.session.actorKind === 'agent' ? <Bot className="size-3" /> : <User className="size-3" />}
                    {commit.session.agent ?? commit.session.actor} · {relativeTime(commit.at)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <TaskActivity
          task={task}
          events={events}
          readOnly={readOnly}
          onAdd={actions.addNote}
          onEdit={actions.editNote}
          onDelete={actions.deleteNote}
          onPublish={task.github ? actions.publishNote : undefined}
        />
      </div>

      <TaskProperties
        task={task}
        project={project}
        readOnly={readOnly}
        parentTitle={parentTitle}
        onPatch={(body) => { void actions.patch(body) }}
        github={actions.github}
      />
    </div>
  )
}
