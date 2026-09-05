'use client'

// One task: what it is, who is on it, what came out of it, and what to do next.
//
// The workspace component holds the shape; this holds what a click does. Every
// mutation refreshes the same set of queries, because a task change moves the
// board, the project page and the dashboard at once.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Project, Task, TaskNote, TaskStatus } from 'portta-contracts'
import { api, ApiError, type TaskBody } from '@/lib/api'
import { keys, useGitHub, useProjectActivity, useSessions, useTask, useTasks } from '@/lib/queries'
import { useCan } from '@/lib/permissions'
import { Card } from '@/components/ui/card'
import { Breadcrumb, type BreadcrumbItem } from '@/components/ui/breadcrumb'
import { useToast } from '@/components/ui/toast'
import { Empty, ErrorBox, Loading } from '@/components/shell-bits'
import { TaskWorkspace } from '@/components/tasks/task-workspace'
import { useKickCreate } from '@/lib/kick-create'
import { taskHref, tasksHref, tasksReturnHref } from '@/lib/tasks'

export function TaskPageView({
  slug,
  id,
  from = null,
  readOnly = false,
  initialTask,
  initialProject,
}: {
  slug: string
  id: string
  from?: string | null
  readOnly?: boolean
  initialTask: Task
  initialProject: Project
}) {
  const { t } = useTranslation('tasks')
  const { t: tn } = useTranslation('nav')
  const queryClient = useQueryClient()
  const router = useRouter()
  const toast = useToast()
  const task = useTask(id, true, initialTask)
  const siblings = useTasks(slug, {})
  const sessions = useSessions(slug, { task: id })
  const activity = useProjectActivity(slug, { task: id, limit: '30' })
  const github = useGitHub()
  const kickCreate = useKickCreate(slug, from === 'tasks' ? { from: 'tasks' } : undefined)
  const listHref = tasksReturnHref(from, tasksHref(slug, 'board'))
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const mayWrite = useCan('task:write', initialProject.id)

  const refresh = (updated?: Task) => {
    if (updated) queryClient.setQueryData(keys.task(id), updated)
    void queryClient.invalidateQueries({ queryKey: keys.task(id) })
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    void queryClient.invalidateQueries({ queryKey: keys.project(slug) })
    void queryClient.invalidateQueries({ queryKey: keys.activity(slug) })
    void queryClient.invalidateQueries({ queryKey: keys.developmentOverview() })
  }
  const failed = (error: unknown) => {
    setSaveState('error')
    toast.push({ title: t('failed'), description: error instanceof Error ? error.message : String(error), tone: 'danger' })
  }

  const crumbs = (parentId: string | null): BreadcrumbItem[] => from === 'tasks'
    ? [
      { label: t('title'), href: listHref },
      { label: initialProject.name, href: `/projects/${encodeURIComponent(slug)}` },
      ...(parentId ? [{ label: `#${parentId}`, href: taskHref(slug, parentId, { from: 'tasks' }) }] : []),
      { label: `#${id}` },
    ]
    : [
      { label: tn('projects'), href: '/projects' },
      { label: initialProject.name, href: `/projects/${encodeURIComponent(slug)}` },
      { label: t('title'), href: listHref },
      ...(parentId ? [{ label: `#${parentId}`, href: taskHref(slug, parentId) }] : []),
      { label: `#${id}` },
    ]

  const patch = useMutation({
    mutationFn: (body: TaskBody) => {
      setSaveState('saving')
      return api.patchTask(id, body)
    },
    onSuccess: (updated) => {
      setSaveState('saved')
      refresh(updated)
    },
    onError: failed,
  })
  const start = useMutation({ mutationFn: () => api.startTask(id), onSuccess: () => refresh(), onError: failed })
  const finish = useMutation({ mutationFn: (close: boolean) => api.finishTask(id, close), onSuccess: () => refresh(), onError: failed })
  const setStatus = useMutation({ mutationFn: (status: TaskStatus) => api.setTaskStatus(id, status), onSuccess: () => refresh(), onError: failed })
  const link = useMutation({ mutationFn: ({ issue, initialSync }: { issue: string; initialSync: 'pull' | 'push' }) => api.linkTaskGitHub(id, issue, initialSync), onSuccess: () => refresh(), onError: failed })
  const unlink = useMutation({ mutationFn: () => api.unlinkTaskGitHub(id), onSuccess: () => refresh(), onError: failed })
  const publish = useMutation({ mutationFn: () => api.publishTaskGitHub(id), onSuccess: () => refresh(), onError: failed })
  const sync = useMutation({ mutationFn: (resolve: 'local' | 'remote' | undefined) => api.syncTaskGitHub(id, resolve), onSuccess: () => refresh(), onError: failed })

  /**
   * One file at a time rather than in parallel: the server caps how many a task
   * may carry, and a burst of eight concurrent uploads would have eight
   * different opinions about how many are already there.
   */
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) await api.addTaskAttachment(id, file)
      return files
    },
    onSuccess: (files) => {
      refresh()
      toast.push({
        tone: 'ok',
        duration: 3000,
        title: files.length === 1
          ? t('attachments.uploaded', { name: files[0]!.name })
          : t('attachments.title', { count: files.length }),
      })
    },
    onError: (error, files) => {
      setSaveState('error')
      toast.push({
        tone: 'danger',
        title: t('attachments.failed', { name: files[0]?.name ?? '' }),
        description: error instanceof ApiError ? [error.message, error.hint].filter(Boolean).join(' · ') : String(error),
      })
    },
  })

  const removeAttachment = useMutation({
    mutationFn: (attachmentId: string) => api.deleteTaskAttachment(id, attachmentId),
    onSuccess: () => refresh(),
    onError: failed,
  })

  const remove = useMutation({
    mutationFn: () => api.deleteTask(id),
    onSuccess: () => {
      refresh()
      router.push(listHref)
    },
    onError: failed,
  })

  if (task.isPending) return <Loading />
  if (task.error) {
    const status = task.error instanceof ApiError ? task.error.status : null
    return (
      <>
        <Breadcrumb items={crumbs(null)} className="-ml-1 mb-3" />
        <Card>
          {status === 404 ? (
            <Empty
              title={t('notFound', { id })}
              hint={<Link className="rounded-xs text-accent hover:underline focus-ring" href={listHref}>{t('backToTasks')}</Link>}
            />
          ) : status === 503 ? (
            <Empty title={t('needsDatabase')} hint={t('needsDatabaseHint')} />
          ) : (
            <ErrorBox error={task.error} />
          )}
        </Card>
      </>
    )
  }

  const data = task.data ?? initialTask

  return (
    <>
      <div className="-ml-1 mb-3">
        <Breadcrumb items={crumbs(data.parentId)} />
      </div>
      <TaskWorkspace
        task={data}
        project={initialProject}
        sessions={sessions.data ?? []}
        events={activity.data?.events ?? []}
        candidates={siblings.data ?? []}
        parentTitle={siblings.data?.find((entry) => entry.id === data.parentId)?.title ?? null}
        readOnly={readOnly || !mayWrite}
        saveState={saveState}
        uploading={upload.isPending}
        actions={{
          uploadAttachments: (files) => upload.mutate(files),
          removeAttachment: (attachment) => removeAttachment.mutate(attachment.id),
          patch: (body) => patch.mutateAsync(body),
          start: () => start.mutate(),
          finish: (close) => finish.mutate(close),
          setStatus: (status) => setStatus.mutate(status),
          addNote: (body) => api.addTaskComment(id, body).then(() => refresh()).catch((error: unknown) => { failed(error); throw error }),
          editNote: (note: TaskNote, body: string) => api.updateTaskComment(id, note.id, body).then(() => refresh()).catch((error: unknown) => { failed(error); throw error }),
          deleteNote: (note) => { void api.deleteTaskComment(id, note.id).then(() => refresh()).catch(failed) },
          publishNote: (note) => api.publishTaskCommentGitHub(id, note.id).then(() => refresh()).catch((error: unknown) => { failed(error); throw error }),
          createSubtask: () => kickCreate.mutate({ parentId: data.id, repositoryId: data.repository?.id ?? null }),
          linkSubtask: (childId) => { void api.linkTaskSubtask(id, childId).then(() => refresh()).catch(failed) },
          unlinkSubtask: (childId) => { void api.unlinkTaskSubtask(id, childId).then(() => refresh()).catch(failed) },
          setSubtaskStatus: (childId, status) => { void api.setTaskStatus(childId, status).then(() => refresh()).catch(failed) },
          discard: () => {
            if (window.confirm(data.draft ? t('draft.confirmDiscard', { id: data.id }) : t('confirmDelete', { id: data.id }))) remove.mutate()
          },
          github: {
            configured: github.data?.status.configured ?? false,
            link: (issue, initialSync) => link.mutateAsync({ issue, initialSync }),
            unlink: () => unlink.mutate(),
            publish: () => publish.mutate(),
            sync: (resolve) => sync.mutate(resolve),
          },
        }}
      />
    </>
  )
}
