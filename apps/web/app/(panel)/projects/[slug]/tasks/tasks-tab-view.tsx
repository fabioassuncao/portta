'use client'

// The tasks tab, reading its view and filters from the URL.

import { useSearchParams } from 'next/navigation'
import type { Project, TaskSummary } from 'portta-contracts'
import { TasksTab } from '@/components/tasks/tasks-view'
import { useCan } from '@/lib/permissions'
import { resolveTaskView, taskFiltersFrom } from '@/lib/tasks'

export function TasksTabView({
  project,
  readOnly,
  initialTasks,
}: {
  project: Project
  readOnly: boolean
  initialTasks: TaskSummary[]
}) {
  const params = useSearchParams()
  const mayWrite = useCan('task:write', project.id)
  return (
    <TasksTab
      project={project}
      view={resolveTaskView(params.get('view'))}
      filters={taskFiltersFrom(new URLSearchParams(params.toString()))}
      readOnly={readOnly || !mayWrite}
      initialTasks={initialTasks}
    />
  )
}
