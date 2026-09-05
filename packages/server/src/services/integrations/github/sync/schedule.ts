// The reconciliation timer.
//
// `docs/github.md` has described reconciliation as running "on demand, and on a
// timer" since the integration shipped. Only the first half was true: the sole
// trigger was `POST /api/integrations/github/sync`, so on the *documented
// default* — a loopback panel, which cannot receive webhook deliveries —
// freshness depended entirely on somebody pressing a button. #25 found it; this
// is the half that was missing.
//
// Deliberately small. It adds no table, no route and no dependency: it calls
// the same `reconcile` the button calls, on an interval, and every property
// that made `reconcile` safe to run — bounded repositories per pass, a cursor
// so the next run resumes, rate-limit pressure ending a run rather than failing
// it — is unchanged, because this does not reimplement any of it.

import type { Database } from '../../../../db/index.ts'
import type { GitHubClient } from '../client.ts'
import { reconcile } from './issues.ts'

/**
 * How often a panel with no webhook re-reads what changed.
 *
 * Fifteen minutes is a compromise between a projection nobody trusts and a
 * budget nobody has: a reconciliation pass asks for issues updated since the
 * stored cursor, so a quiet repository costs one conditional request.
 */
export const DEFAULT_INTERVAL_MINUTES = 15

/**
 * Read the interval from the environment.
 *
 * `0` turns it off, which is the right answer on a panel that *does* receive
 * webhooks and would otherwise be doing the same work twice. Anything
 * unreadable falls back to the default rather than to off: a typo must not
 * silently stop the projection being refreshed.
 */
export function intervalMinutes(configured: string | undefined): number {
  if (configured === undefined || configured.trim() === '') return DEFAULT_INTERVAL_MINUTES
  const parsed = Number(configured)
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_INTERVAL_MINUTES
  return Math.floor(parsed)
}

export interface ScheduleOptions {
  minutes: number
  /** Injected so a test can drive the schedule without waiting for a clock. */
  now?: () => number
  onError?: (error: unknown) => void
}

export interface ReconciliationSchedule {
  start(): void
  stop(): void
  /** Run one pass now, as the button does. Exposed for tests and for `start`. */
  runOnce(): Promise<void>
  readonly running: boolean
}

/**
 * A reconciliation pass on an interval, skipping a tick that arrives while the
 * previous pass is still going.
 *
 * A GitHub App on a slow network can take longer than the interval, and two
 * concurrent passes would double the rate-limit cost to reach the same answer.
 */
export function createReconciliationSchedule(
  client: () => GitHubClient,
  db: Database,
  options: ScheduleOptions,
): ReconciliationSchedule {
  let timer: NodeJS.Timeout | null = null
  let inFlight = false

  async function runOnce(): Promise<void> {
    if (inFlight) return
    inFlight = true
    try {
      await reconcile(client(), db)
    } catch (error) {
      options.onError?.(error)
    } finally {
      inFlight = false
    }
  }

  return {
    get running() { return timer !== null },
    runOnce,
    start(): void {
      if (timer !== null || options.minutes <= 0) return
      // `unref` so the timer never keeps the process alive through a shutdown;
      // the panel's SIGTERM path should not have to wait for a sync.
      timer = setInterval(() => { void runOnce() }, options.minutes * 60_000)
      timer.unref?.()
    },
    stop(): void {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
  }
}
