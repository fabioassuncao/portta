import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { Loading } from '@/components/shell-bits'
import { panelIsReadOnly, projectPage, tasksPage } from '@/lib/server/page-data'
import { TasksTabView } from './tasks-tab-view'

export const dynamic = 'force-dynamic'

export default async function ProjectTasksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = await projectPage(slug)
  if (!project) notFound()
  const tasks = await tasksPage(project.id)

  return (
    // The board's filters are in the URL, and Next wants what reads them to be
    // able to render on its own.
    <Suspense fallback={<Loading />}>
      <TasksTabView project={project} readOnly={panelIsReadOnly()} initialTasks={tasks} />
    </Suspense>
  )
}
