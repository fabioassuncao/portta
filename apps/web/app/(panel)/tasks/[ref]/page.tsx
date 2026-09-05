import { notFound, redirect } from 'next/navigation'
import { taskPage } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

/**
 * A task by itself, addressed without its Project.
 *
 * `portta tasks show` prints `#42`, and an agent that has an id has no slug to
 * go with it. This resolves one to the other and sends the browser to the page
 * the task actually lives on, carrying `from=tasks` so the breadcrumb goes back
 * to the global list rather than into a Project nobody came from.
 */
export default async function TaskByReferencePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  const task = await taskPage(decodeURIComponent(ref).replace(/^#/, ''))
  if (!task || !task.project) notFound()
  redirect(`/projects/${encodeURIComponent(task.project)}/tasks/${encodeURIComponent(task.id)}?from=tasks`)
}
