'use client'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskPriority, TaskStatus } from 'portta-contracts'

export const TASK_STATUS_ORDER: TaskStatus[] = ['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done']

function statusKey(status: string): string {
  return status === 'in_progress' ? 'inProgress' : status
}

export function useTaskStatuses() {
  const { t } = useTranslation('tasks')

  return useMemo(
    () => ({
      statusLabel: (status: TaskStatus | string | null | undefined): string =>
        status ? String(t(`status.${statusKey(status)}` as 'status.backlog')) : t('status.none'),
      statusOptions: TASK_STATUS_ORDER.map((status) => ({ value: status, label: String(t(`status.${statusKey(status)}` as 'status.backlog')) })),
      priorityOptions: [
        { value: '' as const, label: t('priority.none') },
        { value: 'low' as const, label: t('priority.low') },
        { value: 'medium' as const, label: t('priority.medium') },
        { value: 'high' as const, label: t('priority.high') },
        { value: 'urgent' as const, label: t('priority.urgent') },
      ],
      priorityLabel: (priority: TaskPriority | string | null | undefined): string =>
        priority ? String(t(`priority.${priority}` as 'priority.low')) : t('priority.none'),
    }),
    [t],
  )
}

export interface BoardColumn {
  id: string
  label: string
  status: TaskStatus
}

export function useBoardColumns(): BoardColumn[] {
  const { t } = useTranslation('tasks')
  return useMemo(
    () => TASK_STATUS_ORDER.map((status) => ({ id: status, label: String(t(`status.${statusKey(status)}` as 'status.backlog')), status })),
    [t],
  )
}
