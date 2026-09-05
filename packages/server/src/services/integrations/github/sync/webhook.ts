// A delivery GitHub sent, verified before it is parsed as anything meaningful.
//
// The panel refuses any unsafe method without a same-origin `Origin` header,
// and GitHub sends none. The webhook route is the one narrow, deliberate hole
// in that defence, and the signature is what replaces it — so the signature is
// checked first, on the raw body, in constant time.

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Events the panel acts on. Anything else is acknowledged and dropped.
 *
 * `issue_comment` was here and is not any more. Nothing projects a comment —
 * no table stores one, no route reads or writes one — so a delivery bought a
 * whole repository reconciliation to refresh one `updated_at`, on the event
 * that fires most often. The verdict is recorded in
 * docs/adr/0018-github-access-lives-in-the-panel.md: comments stay unprojected,
 * and a write-through endpoint is #26's to build. Reading them is a link to
 * GitHub, which is already what the board offers.
 */
export const HANDLED_EVENTS = [
  'issues',
  'label',
  'milestone',
  'sub_issues',
  'pull_request',
  'repository',
  'installation',
  'installation_repositories',
] as const

export type HandledEvent = (typeof HANDLED_EVENTS)[number]

export function isHandled(event: string): event is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(event)
}

/**
 * `sha256=<hex>` over the raw body, compared in constant time.
 *
 * Returns false for a missing secret, a malformed header and a wrong digest
 * alike: an unverifiable delivery is refused, never given the benefit of the
 * doubt.
 */
export function verifySignature(secret: string, body: string, signature: string | null): boolean {
  if (secret === '' || signature === null) return false
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  const given = Buffer.from(signature)
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length) return false
  return timingSafeEqual(given, wanted)
}

export interface WebhookOutcome {
  /** What the panel should do next; the route turns this into a status. */
  action: 'sync-repository' | 'sync-installations' | 'ignored'
  repository: string | null
  reason: string
}

/**
 * Decides what a verified delivery means, as a pure function.
 *
 * The panel deliberately does not apply a payload directly: GitHub's own
 * response is the source of truth for the projection (a `PATCH` updates from
 * what GitHub returned, never from what was requested), so a delivery is a
 * signal to re-read rather than data to trust.
 */
export function planDelivery(event: string, payload: Record<string, unknown>): WebhookOutcome {
  if (!isHandled(event)) {
    return { action: 'ignored', repository: null, reason: `${event} is not handled` }
  }

  if (event === 'installation' || event === 'installation_repositories') {
    return { action: 'sync-installations', repository: null, reason: `${event} changed what is authorised` }
  }

  const repository = payload['repository'] as { full_name?: string } | undefined
  const fullName = repository?.full_name ?? null
  if (fullName === null) {
    return { action: 'ignored', repository: null, reason: `${event} named no repository` }
  }
  return { action: 'sync-repository', repository: fullName, reason: `${event} changed ${fullName}` }
}
