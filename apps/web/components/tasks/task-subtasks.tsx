'use client'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle } from 'lucide-react'
import type { Task, TaskSummary } from 'portta-contracts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/field.tsx'
import { SectionHeader } from '../shell-bits.tsx'
import { TaskRow } from '../entities/task-row.tsx'
import { taskHref } from '../../lib/tasks.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { overlayItem } from '../ui/surfaces.ts'
import { cn } from '../../lib/utils.ts'

export function TaskSubtasks({
  task,
  candidates,
  readOnly,
  onCreate,
  onLink,
  onUnlink,
  onStatus,
}: {
  task: Task
  candidates: TaskSummary[]
  readOnly?: boolean
  onCreate: () => void
  onLink: (id: string) => void
  onUnlink: (id: string) => void
  onStatus: (id: string, status: TaskSummary['status']) => void
}) {
  const { t } = useTranslation('tasks')
  const [query, setQuery] = useState('')
  const done = task.subtasks.filter((entry) => entry.status === 'done').length
  const linkable = useMemo(
    () => candidates.filter((entry) =>
      entry.id !== task.id
      && entry.parentId !== task.id
      && !task.subtasks.some((child) => child.id === entry.id)
      && (query === '' || entry.title.toLowerCase().includes(query.toLowerCase()) || entry.id.includes(query))),
    [candidates, query, task],
  )

  return (
    <section className="space-y-2">
      <SectionHeader
        title={t('detail.subtasks', { done, total: task.subtasks.length })}
        actions={readOnly ? undefined : (
          <>
            <Button size="sm" onClick={onCreate}>{t('detail.newSubtask')}</Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost">{t('detail.linkExisting')}</Button>
              </PopoverTrigger>
              <PopoverContent padding="list" className="w-72">
                <div className="p-1 pb-1.5">
                  <Input size="sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('detail.searchTasks')} />
                </div>
                {linkable.length === 0 ? <p className="px-2 py-2 text-xs text-subtle">{t('detail.noLinkable')}</p> : linkable.slice(0, 12).map((entry) => (
                  <button key={entry.id} type="button" onClick={() => onLink(entry.id)} className={cn(overlayItem, 'w-full hover:bg-fill focus-ring-inset')}>
                    <span className="truncate">#{entry.id} {entry.title}</span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </>
        )}
      />
      {task.subtasks.length === 0 ? (
        <p className="text-sm text-subtle">{t('detail.noSubtasks')}</p>
      ) : (
        <ul className="divide-y divide-line-subtle rounded-md border border-line">
          {task.subtasks.map((subtask) => (
            <li key={subtask.id}>
              <TaskRow
                task={subtask}
                href={taskHref(task.project, subtask.id)}
                compact
                actions={readOnly ? undefined : (
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => onStatus(subtask.id, subtask.status === 'done' ? 'ready' : 'done')}
                      aria-label={subtask.status === 'done' ? t('detail.reopenSubtask', { id: subtask.id }) : t('detail.completeSubtask', { id: subtask.id })}
                    >
                      {subtask.status === 'done' ? <CheckCircle2 className="text-ok" /> : <Circle />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onUnlink(subtask.id)}>{t('detail.unlinkSubtask')}</Button>
                  </div>
                )}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
