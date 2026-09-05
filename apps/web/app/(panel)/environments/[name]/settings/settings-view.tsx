'use client'

import { useTranslation } from 'react-i18next'
import { useEnvironment } from '@/lib/queries'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Loading } from '@/components/shell-bits'
import { EnvironmentSettingsForm } from '@/components/environment-settings'

export function EnvironmentSettingsView({ name }: { name: string }) {
  const { t } = useTranslation('environments')
  const query = useEnvironment(name)
  if (!query.data) return <Loading />
  return (
    <Card>
      <CardHeader title={t('settings.title')} description={t('settings.description')} />
      <CardBody>
        <EnvironmentSettingsForm project={query.data} />
      </CardBody>
    </Card>
  )
}
