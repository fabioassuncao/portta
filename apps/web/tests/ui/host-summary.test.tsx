import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n/client'
import { HostHeader, HostReadings } from '@/components/host-summary'
import type { HostPressure, MetricsCurrent } from 'portta-contracts'
import { emptySnapshot } from 'portta-core'

function current(overrides: Partial<MetricsCurrent> = {}): MetricsCurrent {
  const snapshot = emptySnapshot({ id: 'i', name: 'lab', hostname: 'lab' }, 1_700_000_000)
  snapshot.host.hostname = 'lab'
  snapshot.host.distro = 'macOS'
  snapshot.host.version = '15.4'
  snapshot.host.architecture = 'arm64'
  snapshot.host.cpu.brand = 'Apple M3 Pro'
  snapshot.host.cpu.logicalCores = 12
  snapshot.host.cpuUtilisation = 0.34
  snapshot.host.memoryTotalBytes = 36 * 1024 ** 3
  snapshot.host.memoryUsedBytes = 18 * 1024 ** 3
  snapshot.host.memoryUsedPercent = 0.5
  return {
    version: 1,
    instance: snapshot.instance,
    collectedAt: snapshot.collectedAt,
    ageSeconds: 4,
    stale: false,
    collectorActive: true,
    host: snapshot.host,
    runtime: { name: 'orbstack' },
    projects: [],
    ...overrides,
  }
}

const normal: HostPressure = { level: 'normal', measured: true, reasons: [] }

function renderSummary(data: MetricsCurrent, pressure: HostPressure = normal) {
  return render(
    <I18nextProvider i18n={i18n}>
      <>
        <HostHeader title="Overview" data={data} pending={false} pressure={pressure} gateway={{ up: true, label: 'Gateway running' }} />
        <HostReadings data={data} />
      </>
    </I18nextProvider>,
  )
}

describe('the host summary', () => {
  it('names the host and its measurements', () => {
    renderSummary(current())
    expect(screen.getByText('lab')).toBeInTheDocument()
    expect(screen.getByText('34%')).toBeInTheDocument()
    expect(screen.getByText(/18 GB \/ 36 GB/)).toBeInTheDocument()
  })

  it('says the host is normal in a word, before it says any number', () => {
    renderSummary(current())
    expect(screen.getByText(/Host · Normal/)).toBeInTheDocument()
  })

  it('reports the verdict the server reached, not one of its own', () => {
    renderSummary(current(), {
      level: 'critical',
      measured: true,
      reasons: [{ resource: 'memory', level: 'pressured', value: 0.96 }],
    })
    expect(screen.getByText(/Host · Critical/)).toBeInTheDocument()
  })

  it('refuses to claim a state when nothing was measured', () => {
    renderSummary(current(), { level: 'normal', measured: false, reasons: [] })
    expect(screen.getByText(/Host · Not measured/)).toBeInTheDocument()
  })

  it('leaves out every metric this host does not report', () => {
    renderSummary(current())
    expect(screen.queryByText('Battery')).not.toBeInTheDocument()
    expect(screen.queryByText('Temp')).not.toBeInTheDocument()
    expect(screen.queryByText('GPU')).not.toBeInTheDocument()
  })

  it('shows battery, temperature and GPU on a host that has them', () => {
    const data = current()
    data.host!.temperatureCelsius = 62
    data.host!.battery = { hasBattery: true, percent: 0.78, charging: false, acConnected: false, minutesRemaining: 190, cycleCount: 120 }
    data.host!.gpu = [{ vendor: 'Apple', model: 'M3 Pro GPU', vramBytes: null, utilisation: 0.21, temperature: null }]
    renderSummary(data)
    expect(screen.getByText('Battery')).toBeInTheDocument()
    expect(screen.getByText('78%')).toBeInTheDocument()
    expect(screen.getByText('62°C')).toBeInTheDocument()
    expect(screen.getByText('21%')).toBeInTheDocument()
  })

  it('says the collector is inactive rather than showing stale numbers as current', () => {
    renderSummary(current({ stale: true, collectorActive: false, ageSeconds: 900 }))
    expect(screen.getByText('Collector inactive')).toBeInTheDocument()
  })

  it('explains itself when there is no snapshot at all', () => {
    renderSummary(current({ host: null }))
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByText('Gateway running')).toBeInTheDocument()
  })
})

describe('the host header', () => {
  it('keeps the route name as the heading a screen reader hears', () => {
    renderSummary(current())
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })

  it('puts the commercial name and the kind first, and the hostname among the facts', () => {
    const data = current()
    data.host!.productName = 'MacBook Pro (14-inch, M3 Pro, Nov 2023)'
    data.host!.kind = 'notebook'
    data.host!.model = 'Mac15,6'
    renderSummary(data)
    const name = screen.getByText(/MacBook Pro/)
    expect(name).toHaveTextContent('MacBook Pro · Notebook')
    expect(name).toHaveAttribute('title', 'MacBook Pro (14-inch, M3 Pro, Nov 2023)')
    expect(screen.getByText(/^lab · Mac15,6 · macOS 15\.4 · arm64/)).toBeInTheDocument()
  })

  it('still calls a machine with a battery a notebook when the collector did not say', () => {
    const data = current()
    data.host!.kind = null
    data.host!.battery = { hasBattery: true, percent: 0.78, charging: false, acConnected: true, minutesRemaining: null, cycleCount: null }
    renderSummary(data)
    expect(screen.getByText(/· Notebook/)).toBeInTheDocument()
  })

  it('names the provider of a virtual machine', () => {
    const data = current()
    data.host!.kind = 'vm'
    data.host!.manufacturer = 'Hetzner'
    data.host!.model = 'vServer'
    renderSummary(data)
    expect(screen.getByText(/· Virtual machine/)).toBeInTheDocument()
    expect(screen.getByText(/^Hetzner · vServer · /)).toBeInTheDocument()
  })

  it('claims nothing about a machine it cannot classify', () => {
    const data = current()
    data.host!.kind = null
    data.host!.manufacturer = 'Apple Inc.'
    renderSummary(data)
    expect(screen.getByText('lab')).toHaveTextContent(/^lab$/)
    expect(screen.queryByText(/Apple Inc\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/· (Notebook|Desktop|Server|Virtual machine)/)).not.toBeInTheDocument()
  })
})
