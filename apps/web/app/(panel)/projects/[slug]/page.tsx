import { notFound } from 'next/navigation'
import { ProjectOverview } from '@/components/projects/project-overview'
import { activityPage, panelIsReadOnly, projectPage, sessionsPage, tasksPage } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

export default async function ProjectOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = await projectPage(slug)
  if (!project) notFound()

  const [tasks, sessions, activity] = await Promise.all([
    tasksPage(project.id),
    sessionsPage({ projectId: project.id }),
    activityPage({ projectId: project.id, limit: 20 }),
  ])

  return (
    <ProjectOverview
      project={project}
      readOnly={panelIsReadOnly()}
      initialTasks={tasks}
      initialSessions={sessions}
      initialActivity={activity}
    />
  )
}
