import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { makeApp, seedIssues, seededDatabase, type SeededDatabase } from './helpers.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import {
  labelsAfter,
  managedLabels,
  priorityFromLabels,
  readMetadata,
  statusFromLabels,
  STATUS_LABELS,
} from '../src/services/integrations/github/metadata.ts'
import { normaliseIssue, visibleLinks, wouldCycle } from '../src/services/integrations/github/issues.ts'
import { HANDLED_EVENTS, planDelivery, verifySignature } from '../src/services/integrations/github/sync/webhook.ts'
import { eq } from 'drizzle-orm'
import { githubIssueRelationships, githubIssues, repositories as repositoriesTable } from 'portta-db'
import type { Issue } from 'portta-contracts'

describe('the label convention', () => {
  it('lives in one table', () => {
    expect(statusFromLabels(['bug', 'status:in-progress'])).toBe('in_progress')
    expect(priorityFromLabels(['priority:urgent'])).toBe('urgent')
    expect(statusFromLabels(['bug'])).toBeNull()
    expect(managedLabels().has(STATUS_LABELS.done)).toBe(true)
  })

  it('is case-insensitive on the way in', () => {
    expect(statusFromLabels(['Status:Review'])).toBe('review')
  })

  it('replaces one status rather than adding a second', () => {
    const next = labelsAfter(['bug', 'status:backlog', 'priority:low'], { status: 'done' })
    expect(next).toEqual(['bug', 'priority:low', 'status:done'])
  })

  it('leaves the other dimension alone', () => {
    const next = labelsAfter(['status:review', 'priority:low'], { priority: 'urgent' })
    expect(next).toEqual(['status:review', 'priority:urgent'])
  })

  it('clears a dimension when it is set to null', () => {
    expect(labelsAfter(['bug', 'status:review'], { status: null })).toEqual(['bug'])
  })
})

describe('reading metadata', () => {
  it('prefers a native field and says so', () => {
    expect(readMetadata({ labels: ['status:backlog'], fields: { status: 'In Progress' } })).toEqual({
      status: 'in_progress',
      priority: null,
      source: 'fields',
    })
  })

  it('falls back to labels, and says that too', () => {
    expect(readMetadata({ labels: ['status:ready', 'priority:high'] })).toEqual({
      status: 'ready',
      priority: 'high',
      source: 'labels',
    })
  })

  it('reports no source when there is nothing to read', () => {
    expect(readMetadata({ labels: ['bug'] })).toEqual({ status: null, priority: null, source: 'none' })
  })
})

describe('normalising an issue', () => {
  const raw = {
    id: 1, node_id: 'I_1', number: 123, title: 'Implementar refresh token',
    body: 'body', state: 'open', type: { name: 'Bug' },
    labels: [{ name: 'status:in-progress' }, 'priority:high'],
    assignees: [{ login: 'fabio' }],
    milestone: { number: 4, title: 'v1', state: 'open' },
    html_url: 'https://github.com/acme/api/issues/123',
    updated_at: '2026-01-01T10:00:00Z',
  }

  it('carries everything a card needs', () => {
    const record = normaliseIssue(raw, 'r1')
    expect(record).toMatchObject({
      number: 123,
      state: 'open',
      issueType: 'Bug',
      workflowStatus: 'in_progress',
      priority: 'high',
      metadataSource: 'labels',
      labels: ['status:in-progress', 'priority:high'],
      assignees: ['fabio'],
      isPullRequest: false,
    })
  })

  it('flags a pull request rather than dropping it', () => {
    expect(normaliseIssue({ ...raw, pull_request: {} }, 'r1').isPullRequest).toBe(true)
  })
})

describe('the sub-issue graph', () => {
  it('refuses a link that would close a cycle', () => {
    const links = [
      { parentNumber: 1, childNumber: 2 },
      { parentNumber: 2, childNumber: 3 },
    ]
    expect(wouldCycle(links, { parentNumber: 3, childNumber: 1 })).toBe(true)
    expect(wouldCycle(links, { parentNumber: 3, childNumber: 4 })).toBe(false)
    expect(wouldCycle([], { parentNumber: 1, childNumber: 1 })).toBe(true)
  })

  it('drops a link whose parent is not visible', () => {
    const links = [
      { parentNumber: 1, childNumber: 2, position: 0 },
      { parentNumber: 99, childNumber: 3, position: 0 },
    ]
    expect(visibleLinks(links, new Set([1, 2, 3]))).toEqual([
      { parentNumber: 1, childNumber: 2, position: 0 },
    ])
  })
})

describe('webhook signatures', () => {
  const secret = 'a-webhook-secret'
  const body = JSON.stringify({ action: 'opened' })
  const valid = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

  it('accepts what GitHub signed', () => {
    expect(verifySignature(secret, body, valid)).toBe(true)
  })

  it('refuses a wrong digest, a missing header and an unset secret alike', () => {
    expect(verifySignature(secret, body, 'sha256=deadbeef')).toBe(false)
    expect(verifySignature(secret, body, null)).toBe(false)
    expect(verifySignature('', body, valid)).toBe(false)
  })

  it('refuses a body that was changed after signing', () => {
    expect(verifySignature(secret, `${body} `, valid)).toBe(false)
  })
})

describe('what a delivery means', () => {
  it('acknowledges an unhandled event rather than failing', () => {
    expect(planDelivery('star', {}).action).toBe('ignored')
  })

  it('re-reads the repository a handled event named', () => {
    expect(planDelivery('issues', { repository: { full_name: 'acme/api' } })).toEqual({
      action: 'sync-repository',
      repository: 'acme/api',
      reason: 'issues changed acme/api',
    })
  })

  it('re-reads what is authorised when the installation changed', () => {
    expect(planDelivery('installation_repositories', {}).action).toBe('sync-installations')
  })

  // Nothing projects a comment, so a delivery bought a whole repository
  // reconciliation to refresh one `updated_at` -- on the event that fires most
  // often. #25 dropped it; ADR 0018's amendment records why.
  it('ignores a comment, because nothing projects one', () => {
    expect(planDelivery('issue_comment', { repository: { full_name: 'acme/api' } }).action).toBe('ignored')
  })

  it('and every event it does act on names something the projection holds', () => {
    for (const event of HANDLED_EVENTS) {
      expect(planDelivery(event, { repository: { full_name: 'acme/api' } }).action, event).not.toBe('ignored')
    }
  })
})

// ---------------------------------------------------------------------------
// The endpoints
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-01T12:00:00Z')

function issueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '1', githubId: 1, nodeId: 'I_1', repositoryId: 'r1', repository: 'acme/api',
    number: 123, title: 'Implementar refresh token', body: null, state: 'open',
    stateReason: null, issueType: 'Bug', workflowStatus: 'in_progress', priority: 'high',
    metadataSource: 'labels', labels: ['status:in-progress'], assignees: ['fabio'],
    milestone: null, htmlUrl: 'https://github.com/acme/api/issues/123',
    isPullRequest: false, githubUpdatedAt: NOW, syncedAt: NOW,
    ...overrides,
  }
}

const open: SeededDatabase[] = []
afterEach(async () => {
  for (const seeded of open.splice(0)) await seeded.close()
})

/**
 * The panel with a Project, its repository, and the issues projected onto it.
 *
 * `repositories: []` drops the repository, which is how a Project that owns no
 * code is stated.
 */
async function app(
  rows: Record<string, unknown>[] = [issueRow()],
  options: { relationships?: Array<{ parent: number; child: number; position: number }>; repositories?: 'none' } = {},
) {
  const seeded = await seededDatabase()
  open.push(seeded)
  if (options.repositories === 'none') {
    await seeded.db.delete(repositoriesTable).where(eq(repositoriesTable.projectId, Number(seeded.ids.project)))
  }
  await seedIssues(seeded, rows)
  for (const link of options.relationships ?? []) {
    const [parent] = await seeded.db.select({ id: githubIssues.id }).from(githubIssues).where(eq(githubIssues.githubId, link.parent))
    const [child] = await seeded.db.select({ id: githubIssues.id }).from(githubIssues).where(eq(githubIssues.githubId, link.child))
    await seeded.db.insert(githubIssueRelationships).values({ parentId: parent!.id, childId: child!.id, position: link.position })
  }
  const issueId = async (githubId: number) => {
    const [row] = await seeded.db.select({ id: githubIssues.id }).from(githubIssues).where(eq(githubIssues.githubId, githubId))
    return String(row!.id)
  }
  return { ...makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, seeded.database), seeded, issueId }
}

describe('the issue endpoints', () => {
  it('lists a Project’s issues with the repository on every row', async () => {
    const { app: server } = await app()
    const body = await (await server.request('/api/projects/produto/issues')).json()
    expect(body.issues).toHaveLength(1)
    expect(body.issues[0]).toMatchObject({
      repository: 'acme/api',
      number: 123,
      status: 'in_progress',
      priority: 'high',
      metadataSource: 'labels',
    })
  })

  it('answers empty for a Project that owns no repository', async () => {
    const { app: server } = await app([issueRow()], { repositories: 'none' })
    const body = await (await server.request('/api/projects/produto/issues')).json()
    expect(body.issues).toEqual([])
  })

  it('404s a workspace that does not exist', async () => {
    const { app: server } = await app()
    expect((await server.request('/api/projects/ghost/issues')).status).toBe(404)
  })

  it('filters by status, priority and text', async () => {
    const rows = [issueRow(), issueRow({ githubId: 2, number: 124, title: 'Outra', workflowStatus: 'backlog', priority: 'low' })]
    const { app: server } = await app(rows)

    const byStatus = await (await server.request('/api/projects/produto/issues?status=backlog')).json()
    expect(byStatus.issues.map((issue: Issue) => issue.number)).toEqual([124])

    const byText = await (await server.request('/api/projects/produto/issues?q=refresh')).json()
    expect(byText.issues.map((issue: Issue) => issue.number)).toEqual([123])
  })

  it('nests a sub-issue under its parent', async () => {
    const rows = [issueRow(), issueRow({ githubId: 2, number: 124, title: 'Sub' })]
    const { app: server, issueId } = await app(rows, {
      relationships: [{ parent: 1, child: 2, position: 0 }],
    })

    const body = await (await server.request('/api/projects/produto/issues')).json()
    const parentId = await issueId(1)
    const childId = await issueId(2)
    const parent = body.issues.find((issue: Issue) => issue.id === parentId)
    const child = body.issues.find((issue: Issue) => issue.id === childId)
    expect(parent.childIds).toEqual([childId])
    expect(child.parentId).toBe(parentId)
  })

  it('marks the projection stale rather than hiding it', async () => {
    const old = new Date(Date.now() - 3_600_000)
    const { app: server, seeded } = await app([issueRow()])
    await seeded.db.update(githubIssues).set({ syncedAt: old })
    const body = await (await server.request('/api/projects/produto/issues')).json()
    expect(body.issues[0].stale).toBe(true)
  })

  it('answers 503 with a hint when the projection is unavailable', async () => {
    const { app: server } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const response = await server.request('/api/issues')
    expect(response.status).toBe(503)
  })

  it('refuses a write when no GitHub App is configured', async () => {
    const { app: server, issueId } = await app()
    const response = await server.request(`/api/issues/${await issueId(1)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('not configured')
  })
})

describe('the webhook route', () => {
  it('refuses an unsigned delivery without parsing it', async () => {
    const { app: server } = makeApp({ containers: GATEWAY }, { githubWebhookSecret: 'a-secret' })
    const response = await server.request('/api/integrations/github/webhook', {
      method: 'POST',
      body: 'not even json',
      headers: { 'content-type': 'application/json', 'x-github-event': 'issues' },
    })
    expect(response.status).toBe(401)
  })

  it('accepts a signed delivery even though GitHub sends no Origin header', async () => {
    const secret = 'a-secret'
    const body = JSON.stringify({ repository: { full_name: 'acme/api' } })
    const { app: server } = makeApp({ containers: GATEWAY }, { githubWebhookSecret: secret })

    const response = await server.request('/api/integrations/github/webhook', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'issues',
        'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      },
    })
    expect(response.status).toBe(200)
  })

  it('acknowledges an unhandled event', async () => {
    const secret = 'a-secret'
    const body = JSON.stringify({ repository: { full_name: 'acme/api' } })
    const { app: server } = makeApp({ containers: GATEWAY }, { githubWebhookSecret: secret })

    const response = await server.request('/api/integrations/github/webhook', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'star',
        'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      },
    })
    expect((await response.json()).action).toBe('ignored')
  })

  it('is still refused in read-only mode', async () => {
    const secret = 'a-secret'
    const body = JSON.stringify({ repository: { full_name: 'acme/api' } })
    const { app: server } = makeApp({ containers: GATEWAY }, { githubWebhookSecret: secret, readOnly: true })

    const response = await server.request('/api/integrations/github/webhook', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'issues',
        'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      },
    })
    expect(response.status).toBe(403)
  })

  it('leaves every other route refusing a cross-origin write', async () => {
    const { app: server } = makeApp({ containers: GATEWAY })
    const response = await server.request('/api/gateway/doctor', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json', origin: 'https://evil.test', host: 'localhost' },
    })
    expect(response.status).toBe(403)
  })
})
