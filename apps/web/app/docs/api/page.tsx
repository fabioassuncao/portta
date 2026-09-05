import type { Metadata } from 'next'
import { ApiReference } from '@/components/docs/api'

// The console issues real requests against this panel, so the page is rendered
// on request rather than baked into the build: what it documents is whatever
// this process is serving right now.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'API reference · Documentation' }

export default function ApiPage() {
  return (
    <>
      <p className="mb-1 text-sm text-muted">Reference</p>
      <ApiReference />
    </>
  )
}
