import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INTERVAL_MINUTES, createReconciliationSchedule, intervalMinutes } from '../src/services/integrations/github/sync/schedule.ts'

describe('intervalMinutes', () => {
  it('defaults to fifteen minutes when nothing is configured', () => {
    expect(intervalMinutes(undefined)).toBe(DEFAULT_INTERVAL_MINUTES)
    expect(intervalMinutes('')).toBe(DEFAULT_INTERVAL_MINUTES)
    expect(intervalMinutes('   ')).toBe(DEFAULT_INTERVAL_MINUTES)
  })

  // A panel that receives webhook deliveries is already fresh, and would
  // otherwise be doing the same work twice.
  it('takes 0 as off', () => {
    expect(intervalMinutes('0')).toBe(0)
  })

  it('takes a number', () => {
    expect(intervalMinutes('5')).toBe(5)
    expect(intervalMinutes('60')).toBe(60)
  })

  // Falling back to *off* would silently stop the projection being refreshed,
  // which is exactly the failure this timer exists to fix.
  it('falls back to the default for a value it cannot read, never to off', () => {
    for (const value of ['nonsense', '-1', 'NaN', '1e999999']) {
      expect(intervalMinutes(value), value).toBe(DEFAULT_INTERVAL_MINUTES)
    }
  })
})

describe('the reconciliation schedule', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function harness(minutes: number, run: () => Promise<unknown> = async () => []) {
    const calls: number[] = []
    const db = { github: { listRepositories: async () => { calls.push(Date.now()); return run() }, listSyncState: async () => [] } }
    const schedule = createReconciliationSchedule(
      () => ({}) as never,
      db as never,
      { minutes },
    )
    return { schedule, calls }
  }

  it('does not start at all when the interval is zero', () => {
    const { schedule } = harness(0)
    schedule.start()
    expect(schedule.running).toBe(false)
  })

  it('runs once per interval', async () => {
    const { schedule, calls } = harness(15)
    schedule.start()
    expect(schedule.running).toBe(true)
    expect(calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(calls).toHaveLength(2)

    schedule.stop()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(calls).toHaveLength(2)
  })

  // A GitHub App on a slow network can take longer than the interval, and two
  // concurrent passes would double the rate-limit cost to reach one answer.
  it('skips a tick that arrives while the previous pass is still going', async () => {
    let release: () => void = () => {}
    const blocked = new Promise<never[]>((resolve) => { release = () => resolve([]) })
    const { schedule, calls } = harness(1, () => blocked)
    schedule.start()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(1)

    release()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(2)
    schedule.stop()
  })

  // The projection is the thing that must keep working. A failed pass is
  // reported and the next one still happens.
  it('reports a failure and keeps the schedule', async () => {
    const errors: unknown[] = []
    const db = { github: { listRepositories: async () => { throw new Error('rate limit') }, listSyncState: async () => [] } }
    const schedule = createReconciliationSchedule(() => ({}) as never, db as never, { minutes: 1, onError: (error) => errors.push(error) })
    schedule.start()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(errors).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(errors).toHaveLength(2)
    expect(schedule.running).toBe(true)
    schedule.stop()
  })

  it('is idempotent: starting twice runs one timer, stopping twice is harmless', async () => {
    const { schedule, calls } = harness(1)
    schedule.start()
    schedule.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(1)
    schedule.stop()
    schedule.stop()
    expect(schedule.running).toBe(false)
  })
})
