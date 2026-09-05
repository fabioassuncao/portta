'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type TaskBody } from './api/index.ts'
import { TASK_DRAFT_TITLE } from './task-draft.ts'
import { keys } from './queries/index.ts'
import { useRouter } from 'next/navigation'
import { taskHref } from './tasks.ts'

/** Create (or reopen) a draft and open its workspace. */
export function useKickCreate(slug: string, options?: { from?: 'tasks' }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: (body: TaskBody | void) => api.createTask(slug, { title: TASK_DRAFT_TITLE, draft: true, ...(body ?? {}) }),
    onSuccess: (task) => {
      queryClient.setQueryData(keys.task(task.id), task)
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      router.push(taskHref(slug, task.id, options))
    },
  })
}
