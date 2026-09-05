'use client'

// What the panel talks to that is not the host: GitHub, today.
//
// The credentials are the same `.env` keys General edits, shown here because
// what somebody wants beside them is the connection's state — whether the token
// works, what it reaches, when it last synced.

import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Save } from 'lucide-react'
import type { ConfigField } from 'portta-contracts'
import { api } from '@/lib/api'
import { keys, useConfig } from '@/lib/queries'
import { useCan } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout, ErrorBox, Loading, PageHeader } from '@/components/shell-bits'
import { SettingsGroup } from '@/components/settings/settings-group'
import { displayValue } from '@/components/settings/values'
import { GitHubStatusCard } from '@/components/github-status'

const GROUP = 'GitHub'

export function IntegrationsView() {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  // Writing these is writing the `.env`, which is `settings:manage`. Holding
  // `github:manage` is what the sync actions ask for, and the card asks itself.
  const mayManage = useCan('settings:manage')
  const [draft, setDraft] = useState<Record<string, string | null>>({})
  const [error, setError] = useState<unknown>(null)
  const query = useConfig()

  const save = useMutation({
    mutationFn: () => api.patchConfig(draft),
    onSuccess: () => {
      setDraft({})
      setError(null)
      void queryClient.invalidateQueries({ queryKey: keys.config() })
      void queryClient.invalidateQueries({ queryKey: keys.apply() })
    },
    onError: setError,
  })

  const fields = useMemo(
    () => (query.data?.fields ?? []).filter((field) => field.group === GROUP),
    [query.data?.fields],
  )

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />

  const dirty = Object.keys(draft).length > 0

  const valueOf = (field: ConfigField): string => {
    const pending = draft[field.key]
    if (pending !== undefined) return pending ?? ''
    return displayValue(field, draft)
  }

  return (
    <>
      <PageHeader
        title={t('integrations.title')}
        description={t('integrations.description')}
        actions={
          mayManage ? (
            <>
              {dirty ? <Badge tone="warn">{tc('unsaved', { count: Object.keys(draft).length })}</Badge> : null}
              <Button
                variant="ghost"
                disabled={!dirty || save.isPending}
                onClick={() => setDraft({})}
              >
                {tc('discard')}
              </Button>
              <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                <Save />
                {save.isPending ? tc('saving') : tc('save')}
              </Button>
            </>
          ) : null
        }
      />

      {error ? <div className="mb-4"><ErrorBox error={error} /></div> : null}
      {query.data && !query.data.envFile.writable ? (
        <Callout tone="warn" className="mb-4">{t('notWritable', { path: query.data.envFile.path })}</Callout>
      ) : null}

      <div className="grid gap-4">
        <GitHubStatusCard />
        <SettingsGroup
          name={GROUP}
          fields={fields}
          valueOf={valueOf}
          onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
        />
      </div>
    </>
  )
}
