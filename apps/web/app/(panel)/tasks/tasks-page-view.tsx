'use client'

// Every task on the panel: the same board and table a Project tab uses, with
// no Project implied until one is picked to create in or to filter by.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { ProjectSummary, TaskSummary } from 'portta-contracts'
import { ApiError } from '@/lib/api'
import { useProjects } from '@/lib/queries'
import { useCan } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Select } from '@/components/ui/field'
import { Empty, ErrorBox, PageHeader } from '@/components/shell-bits'
import { TasksView } from '@/components/tasks/tasks-view'
import { useKickCreate } from '@/lib/kick-create'
import { rememberTasksReturn, resolveTaskView, restoreTasksScroll, taskFiltersFrom, tasksHref } from '@/lib/tasks'

export function TasksPageView({
  initialProjects,
  initialTasks,
  readOnly = false,
}: {
  initialProjects: ProjectSummary[]
  initialTasks: TaskSummary[]
  readOnly?: boolean
}) {
  const { t } = useTranslation('tasks')
  const catalog = useProjects(initialProjects)
  const [picking, setPicking] = useState(false)
  // The filters live in the URL, so a filtered board is a link somebody can
  // paste. `useSearchParams` is Next's read of the same thing the hash was.
  const params = useSearchParams()
  const view = resolveTaskView(params.get('view'))
  const filters = taskFiltersFrom(new URLSearchParams(params.toString()))
  const listHref = tasksHref({ global: true }, view, filters)
  const projects = (catalog.data ?? []).filter((project) => !project.archived)
  const unavailable = catalog.error instanceof ApiError && catalog.error.status === 503
  const mayCreate = useCan('task:write')

  useEffect(() => {
    restoreTasksScroll()
  }, [])

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          mayCreate ? (
            <Button variant="primary" disabled={readOnly || projects.length === 0} onClick={() => setPicking(true)}>
              <Plus />
              {t('newTask')}
            </Button>
          ) : undefined
        }
      />
      {catalog.error && !unavailable ? (
        <ErrorBox error={catalog.error} />
      ) : (
        <TasksView
          scope={{ kind: 'global', projects: catalog.data ?? [] }}
          view={view}
          filters={filters}
          readOnly={readOnly || !mayCreate}
          initialTasks={initialTasks}
        />
      )}
      {picking ? (
        <PickProjectDialog
          open
          onOpenChange={setPicking}
          projects={projects}
          listHref={listHref}
          {...(filters.project ? { preset: filters.project } : {})}
        />
      ) : null}
    </>
  )
}

function PickProjectDialog({
  open,
  onOpenChange,
  projects,
  listHref,
  preset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: ProjectSummary[]
  listHref: string
  preset?: string
}) {
  const { t } = useTranslation('tasks')
  const [slug, setSlug] = useState(() => (preset && projects.some((project) => project.slug === preset) ? preset : projects[0]?.slug ?? ''))
  const kick = useKickCreate(slug, { from: 'tasks' })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('pickProject')}
      description={t('pickProjectHint')}
      size="sm"
      footer={
        <Button
          variant="primary"
          size="sm"
          busy={kick.isPending}
          disabled={slug === ''}
          onClick={() => {
            rememberTasksReturn(listHref)
            kick.mutate()
          }}
        >
          {t('newTask')}
        </Button>
      }
    >
      {projects.length === 0 ? (
        <Empty title={t('noProjects')} />
      ) : (
        <Field label={t('projectFilter')} required>
          {(id) => (
            <Select id={id} value={slug} onChange={(event) => setSlug(event.target.value)} aria-label={t('projectFilter')}>
              {projects.map((project) => (
                <option key={project.slug} value={project.slug}>{project.name}</option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </Dialog>
  )
}
