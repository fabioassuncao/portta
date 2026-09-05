import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeApp } from './helpers.ts'
import { GATEWAY } from './fixtures.ts'
import { MetricsCurrent, type MetricsHistory } from 'portta-contracts'
import { emptySnapshot } from 'portta-core'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function metricsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'portta-metrics-'))
  dirs.push(dir)
  return dir
}

describe('GET /api/metrics/current', () => {
  it('answers empty when the collector has not written yet', async () => {
    const dir = metricsDir()
    const { app } = makeApp({ containers: GATEWAY }, { metricsDir: dir, metricsStaleSeconds: 30 })
    const body = (await (await app.request('/api/metrics/current')).json()) as MetricsCurrent
    expect(body.host).toBeNull()
    expect(body.collectorActive).toBe(false)
    expect(body.stale).toBe(true)
    expect(body.projects).toEqual([])
  })

  it('returns the snapshot and flags it stale after 30s', async () => {
    const dir = metricsDir()
    const snapshot = emptySnapshot({ id: 'inst', name: 'lab', hostname: 'lab' }, 1_000)
    snapshot.host.cpuUtilisation = 0.34
    snapshot.host.memoryTotalBytes = 36
    snapshot.host.memoryUsedBytes = 18
    snapshot.projects = [{
      id: 'alpha',
      name: 'Alpha',
      composeProject: 'alpha',
      cpuUtilisation: 0.2,
      memoryUsedBytes: 4,
      containerCount: 1,
      networkRxBytes: 0,
      networkTxBytes: 0,
      containers: [],
    }]
    writeFileSync(join(dir, 'current.json'), JSON.stringify(snapshot))
    const { app } = makeApp({ containers: GATEWAY }, { metricsDir: dir, metricsStaleSeconds: 30 })
    const body = (await (await app.request('/api/metrics/current')).json()) as MetricsCurrent
    expect(body.host?.cpuUtilisation).toBe(0.34)
    expect(body.projects[0]?.name).toBe('Alpha')
    expect(body.stale).toBe(true)
    expect(body.collectorActive).toBe(false)
  })

  it('completes a snapshot from a collector that predates kind and productName', async () => {
    const dir = metricsDir()
    const snapshot = emptySnapshot({ id: 'inst', name: 'lab', hostname: 'lab' }, 1_000)
    const older = snapshot.host as Partial<typeof snapshot.host>
    delete older.kind
    delete older.productName
    writeFileSync(join(dir, 'current.json'), JSON.stringify(snapshot))
    const { app } = makeApp({ containers: GATEWAY }, { metricsDir: dir, metricsStaleSeconds: 30 })
    const body = (await (await app.request('/api/metrics/current')).json()) as MetricsCurrent
    expect(body.host?.kind).toBeNull()
    expect(body.host?.productName).toBeNull()
    expect(() => MetricsCurrent.parse(body)).not.toThrow()
  })

  it('treats a malformed file as not collected', async () => {
    const dir = metricsDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'current.json'), '{broken\n')
    const { app } = makeApp({ containers: GATEWAY }, { metricsDir: dir })
    const body = (await (await app.request('/api/metrics/current')).json()) as MetricsCurrent
    expect(body.collectedAt).toBeNull()
    expect(body.host).toBeNull()
  })
})

describe('GET /api/metrics/history', () => {
  it('returns points inside the requested window', async () => {
    const dir = metricsDir()
    const now = Math.floor(Date.now() / 1000)
    writeFileSync(join(dir, 'history.jsonl'), [
      JSON.stringify({ timestamp: now - 4000, host: { cpuUtilisation: 0.9 }, projects: [], containers: [] }),
      JSON.stringify({ timestamp: now - 60, host: { cpuUtilisation: 0.2, memoryUsedBytes: 1, memoryUsedPercent: 0.1, storageUsedPercent: null, load: null, gpuUtilisation: null }, projects: [], containers: [] }),
      '',
    ].join('\n'))
    const { app } = makeApp({ containers: GATEWAY }, { metricsDir: dir })
    const body = (await (await app.request('/api/metrics/history?window=30m')).json()) as MetricsHistory
    expect(body.windowSeconds).toBe(1800)
    expect(body.points).toHaveLength(1)
    expect(body.points[0]?.host.cpuUtilisation).toBe(0.2)
  })
})
