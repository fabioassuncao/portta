import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { TaskPageView } from '@/components/tasks/task-page-view'
import { panelIsReadOnly, projectPage, taskPage } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string; id: string }> }): Promise<Metadata> {
  const { id } = await params
  const task = await taskPage(id)
  return { title: task ? `#${task.id} ${task.title}` : `#${id}` }
}

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const [{ slug, id }, { from }] = await Promise.all([params, searchParams])
  const [project, task] = await Promise.all([projectPage(slug), taskPage(id)])
  // A task in a Project this caller is not in, and one that does not exist, are
  // the same answer. The layout already refused the Project itself.
  if (!project || !task || task.project !== project.slug) notFound()

  return (
    <TaskPageView
      slug={project.slug}
      id={task.id}
      from={from ?? null}
      readOnly={panelIsReadOnly()}
      initialTask={task}
      initialProject={project}
    />
  )
}
