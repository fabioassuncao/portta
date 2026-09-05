'use client'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Bot, GitBranch, MessageSquare, Trash2, User } from 'lucide-react'
import type { ActivityEvent, Task, TaskNote } from 'portta-contracts'
import { Button } from '../ui/button.tsx'
import { Timeline, TimelineItem } from '../ui/timeline.tsx'
import { useFormat } from '../../lib/use-format.ts'
import { narrowTone, type Tone } from '../../lib/tone.ts'
import { SectionHeader } from '../shell-bits.tsx'
import { MarkdownEditor } from './markdown-editor.tsx'
import { MarkdownView } from './markdown-view.tsx'

type Entry =
  | { kind: 'event'; at: number; id: string; event: ActivityEvent }
  | { kind: 'comment'; at: number; id: string; note: TaskNote }

function toneOf(kind: string): Tone {
  if (kind === 'task.conflict') return narrowTone('danger')
  if (kind === 'task.deleted') return narrowTone('warn')
  if (kind === 'task.created' || kind === 'task.comment' || kind === 'task.note') return narrowTone('info')
  if (kind === 'task.status') return narrowTone('ok')
  return narrowTone('neutral')
}

/** The kinds worth an icon on the rail; every other event keeps the dot. */
function markerOf(kind: string) {
  if (kind === 'task.conflict') return <AlertTriangle />
  if (kind === 'task.deleted') return <Trash2 />
  return undefined
}

export function TaskActivity({
  task,
  events,
  readOnly,
  onAdd,
  onEdit,
  onDelete,
  onPublish,
}: {
  task: Task
  events: ActivityEvent[]
  readOnly?: boolean
  onAdd: (body: string) => Promise<unknown>
  onEdit: (note: TaskNote, body: string) => Promise<unknown>
  onDelete: (note: TaskNote) => void
  onPublish?: (note: TaskNote) => Promise<unknown>
}) {
  const { t } = useTranslation('tasks')
  const { relativeTime } = useFormat()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')

  const feed = useMemo(() => {
    const commentIds = new Set(task.notes.map((note) => note.id))
    const entries: Entry[] = [
      ...task.notes.map((note) => ({ kind: 'comment' as const, at: note.createdAt, id: `note-${note.id}`, note })),
      ...events
        .filter((event) => {
          if (event.kind !== 'task.comment' && event.kind !== 'task.note') return true
          const commentId = event.data['commentId'] ?? event.data['noteId']
          return typeof commentId !== 'string' || !commentIds.has(commentId)
        })
        .map((event) => ({ kind: 'event' as const, at: event.at, id: event.id, event })),
    ]
    return entries.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  }, [events, task.notes])

  const submit = () => {
    if (draft.trim() === '') return
    void onAdd(draft.trim()).then(() => setDraft(''))
  }

  return (
    <section className="space-y-3">
      <SectionHeader title={t('detail.activity')} />
      {feed.length === 0 ? (
        <p className="text-sm text-subtle">{t('detail.noActivityYet')}</p>
      ) : (
        <Timeline>
          {feed.map((entry) => entry.kind === 'event' ? (
            <TimelineItem key={entry.id} time={relativeTime(entry.event.at)} tone={toneOf(entry.event.kind)} marker={markerOf(entry.event.kind)}>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <span className="min-w-0">{entry.event.summary}</span>
                {entry.event.actor ? (
                  <span className="inline-flex items-center gap-1 text-2xs text-subtle">
                    {entry.event.actorKind === 'agent' ? <Bot className="size-3" /> : <User className="size-3" />}
                    {entry.event.actor}
                  </span>
                ) : null}
              </div>
            </TimelineItem>
          ) : (
            <TimelineItem key={entry.id} time={relativeTime(entry.note.createdAt)} tone="info" marker={<MessageSquare />}>
              <div className="group min-w-0">
                <div className="flex flex-wrap items-center gap-1 text-2xs text-subtle">
                  {entry.note.actorKind === 'agent' ? <Bot className="size-3" /> : <User className="size-3" />}
                  <span>{entry.note.actor ?? t('detail.someone')}</span>
                  {entry.note.updatedAt ? <span>· {t('detail.edited')}</span> : null}
                  {entry.note.publishState === 'synced' ? <span className="inline-flex items-center gap-1"><GitBranch className="size-3" />GitHub</span> : null}
                  {readOnly ? null : (
                    <span className="ml-auto flex gap-0.5 row-actions">
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(entry.note.id); setEditBody(entry.note.body) }}>{t('detail.editNote')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => onDelete(entry.note)}>{t('detail.deleteNote')}</Button>
                      {onPublish && entry.note.publishState !== 'synced' ? <Button size="sm" variant="ghost" onClick={() => void onPublish(entry.note)}>{entry.note.publishState === 'error' ? t('detail.retryPublish') : t('detail.publishComment')}</Button> : null}
                    </span>
                  )}
                </div>
                {editing === entry.note.id ? (
                  <div className="mt-2 space-y-2">
                    <MarkdownEditor compact value={editBody} onChange={setEditBody} onEscape={() => setEditing(null)} onSubmit={() => void onEdit(entry.note, editBody).then(() => setEditing(null))} />
                    <div className="flex gap-1">
                      <Button size="sm" variant="primary" onClick={() => void onEdit(entry.note, editBody).then(() => setEditing(null))}>{t('dialog.save')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('detail.cancel')}</Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 rounded-md border border-line bg-surface-2/40 px-3 py-2"><MarkdownView source={entry.note.body} /></div>
                )}
                {entry.note.publishError ? <p className="mt-1 text-xs text-danger">{entry.note.publishError}</p> : null}
              </div>
            </TimelineItem>
          ))}
        </Timeline>
      )}
      {readOnly ? null : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <MarkdownEditor compact value={draft} onChange={setDraft} placeholder={t('detail.notePlaceholder')} onEscape={() => setDraft('')} onSubmit={submit} />
          <Button size="sm" type="submit" disabled={draft.trim() === ''}>{t('detail.addNote')}</Button>
        </form>
      )}
    </section>
  )
}
