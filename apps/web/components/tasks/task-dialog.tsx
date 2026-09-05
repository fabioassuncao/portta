'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api, type TaskBody } from '../../lib/api/index.ts'
import { keys } from '../../lib/queries/index.ts'
import type { Project, Task, TaskPriority, TaskStatus, TaskSummary } from 'portta-contracts'
import { Button } from '../ui/button.tsx'
import { Dialog } from '../ui/dialog.tsx'
import { Field, Input, Select, Textarea } from '../ui/field.tsx'
import { ErrorBox } from '../shell-bits.tsx'
import { useTaskStatuses } from '@/lib/i18n/use-task-statuses.ts'

type Mode =
  | { mode: 'create'; slug: string; parent?: TaskSummary | null; defaults?: Partial<TaskBody> }
  | { mode: 'edit'; slug: string; task: Task }

/**
 * Create or edit a task. Everything here is Portta's own row; a bound task
 * carries its change to GitHub afterwards, and says so on its page.
 */
export function TaskDialog(props: Mode & { project?: Project | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved?: (task: Task) => void }) {
  const { t } = useTranslation('tasks')
  const { statusOptions, priorityOptions } = useTaskStatuses()
  const queryClient = useQueryClient()
  const editing = props.mode === 'edit' ? props.task : null
  const defaults = props.mode === 'create' ? props.defaults ?? {} : {}

  const [title, setTitle] = useState(editing?.title ?? defaults.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? defaults.description ?? '')
  const [status, setStatus] = useState<TaskStatus>(editing?.status ?? (defaults.status as TaskStatus | undefined) ?? 'backlog')
  const [priority, setPriority] = useState<TaskPriority | ''>(editing?.priority ?? (defaults.priority as TaskPriority | undefined) ?? '')
  const [type, setType] = useState(editing?.type ?? defaults.type ?? '')
  const [labels, setLabels] = useState((editing?.labels ?? defaults.labels ?? []).join(', '))
  const [assignee, setAssignee] = useState(editing?.assignee ?? defaults.assignee ?? '')
  const [agent, setAgent] = useState(editing?.agent ?? defaults.agent ?? '')
  const [repositoryId, setRepositoryId] = useState(editing?.repository?.id ?? defaults.repositoryId ?? '')
  const [environment, setEnvironment] = useState(editing?.environment ?? '')
  const [service, setService] = useState(editing?.service ?? defaults.service ?? '')
  const parentId = props.mode === 'create' ? props.parent?.id ?? defaults.parentId ?? null : editing?.parentId ?? null

  const environments = props.project?.environments ?? []
  const environmentIdOf = (name: string) => (name === '' ? null : (environments.find((entry) => entry.environment === name)?.environment ?? null))

  const submit = useMutation({
    mutationFn: () => {
      const body: TaskBody = {
        title: title.trim(),
        description: description.trim() === '' ? null : description,
        status,
        priority: priority === '' ? null : priority,
        type: type.trim() === '' ? null : type.trim(),
        labels: labels.split(',').map((entry) => entry.trim()).filter((entry) => entry !== ''),
        assignee: assignee.trim() === '' ? null : assignee.trim(),
        agent: agent.trim() === '' ? null : agent.trim(),
        repositoryId: repositoryId === '' ? null : repositoryId,
        service: service.trim() === '' ? null : service.trim(),
      }
      if (props.mode === 'create') return api.createTask(props.slug, { ...body, parentId, ...(environmentIdOf(environment) ? { environmentId: environmentIdOf(environment) } : {}) })
      return api.patchTask(props.task.id, body)
    },
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: keys.project(props.slug) })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: keys.developmentOverview() })
      props.onSaved?.(task)
      props.onOpenChange(false)
    },
  })

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={editing ? t('dialog.editTitle', { id: editing.id }) : props.mode === 'create' && props.parent ? t('dialog.newSubtask', { id: props.parent.id }) : t('dialog.newTask')}
      description={editing?.github ? t('dialog.boundDescription') : t('dialog.localDescription')}
      footer={
        <Button variant="primary" size="sm" disabled={submit.isPending || title.trim() === ''} onClick={() => submit.mutate()}>
          {editing ? t('dialog.save') : t('dialog.create')}
        </Button>
      }
    >
      {submit.error ? <ErrorBox error={submit.error} /> : null}
      <div className="space-y-3">
        <Field label={t('dialog.title')}>
          {(id) => <Input id={id} value={title} onChange={(event) => setTitle(event.target.value)} aria-label={t('dialog.title')} />}
        </Field>
        <Field label={t('dialog.description')}>
          {(id) => (
            <Textarea
              id={id}
              mono
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-label={t('dialog.description')}
              rows={4}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('dialog.status')}>
            {(id) => (
              <Select id={id} value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)} aria-label={t('dialog.status')} className="w-full">
                {statusOptions.map((entry) => (
                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('dialog.priority')}>
            {(id) => (
              <Select id={id} value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority | '')} aria-label={t('dialog.priority')} className="w-full">
                {priorityOptions.map((entry) => (
                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('dialog.type')}>
            {(id) => <Input id={id} value={type} onChange={(event) => setType(event.target.value)} placeholder={t('dialog.typePlaceholder')} aria-label={t('dialog.type')} />}
          </Field>
          <Field label={t('dialog.labels')}>
            {(id) => <Input id={id} value={labels} onChange={(event) => setLabels(event.target.value)} placeholder={t('dialog.labelsPlaceholder')} aria-label={t('dialog.labels')} />}
          </Field>
          <Field label={t('dialog.assignee')}>
            {(id) => <Input id={id} value={assignee} onChange={(event) => setAssignee(event.target.value)} aria-label={t('dialog.assignee')} />}
          </Field>
          <Field label={t('dialog.agent')}>
            {(id) => <Input id={id} value={agent} onChange={(event) => setAgent(event.target.value)} placeholder="claude-code" aria-label={t('dialog.agent')} />}
          </Field>
          <Field label={t('dialog.repository')}>
            {(id) => (
              <Select id={id} value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)} aria-label={t('dialog.repository')} className="w-full">
                <option value="">{t('dialog.wholeProject')}</option>
                {(props.project?.repositories ?? []).map((repository) => (
                  <option key={repository.id} value={repository.id}>{repository.name}</option>
                ))}
              </Select>
            )}
          </Field>
          {props.mode === 'create' ? (
            <Field label={t('dialog.environment')}>
              {(id) => (
                <Select id={id} value={environment} onChange={(event) => setEnvironment(event.target.value)} aria-label={t('dialog.environment')} className="w-full">
                  <option value="">{t('dialog.noEnvironment')}</option>
                  {environments.map((entry) => (
                    <option key={entry.environment} value={entry.environment}>{entry.environment}</option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label={t('dialog.service')}>
            {(id) => <Input id={id} value={service} onChange={(event) => setService(event.target.value)} placeholder="api" aria-label={t('dialog.service')} />}
          </Field>
        </div>
      </div>
    </Dialog>
  )
}
