import type { Metadata } from 'next'
import { Suspense } from 'react'
import { readProjects, readTasks } from 'portta-server'
import { redirect } from 'next/navigation'
import { serverDeps } from '@/lib/server/deps'
import { requirePrincipal } from '@/lib/server/principal'
import { serverTranslation } from '@/lib/i18n/server'
import { Loading } from '@/components/shell-bits'
import { TasksPageView } from './tasks-page-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('tasks')
  return { title: t('title') }
}

export default async function TasksPage() {
  const deps = serverDeps()
  const principal = await requirePrincipal()
  if (!principal) redirect('/sign-in')

  const [projects, tasks] = await Promise.all([
    readProjects(deps, principal),
    readTasks(deps, principal, { limit: 2000 }),
  ])
  return (
    // `useSearchParams` needs a boundary: the filters are in the URL, and Next
    // wants the part that reads them to be able to render on its own.
    <Suspense fallback={<Loading />}>
      <TasksPageView
        initialProjects={projects}
        initialTasks={tasks}
        readOnly={deps.config.readOnly}
      />
    </Suspense>
  )
}
