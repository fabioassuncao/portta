import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from '../../deps.ts'
import { githubStatus } from '../../services/integrations/github/status.ts'

/** Re-exported so the routes that report it keep one import. */
export { githubStatus as githubStatusOf } from '../../services/integrations/github/status.ts'
import { requireDatabase } from '../../db/index.ts'
import { planDelivery, verifySignature } from '../../services/integrations/github/sync/webhook.ts'
import { reconcile, syncRepositoryIssues } from '../../services/integrations/github/sync/issues.ts'
import {
  GitHubIntegrationView,
  GitHubRepositoryView,
} from 'portta-contracts'
import { documentRoute } from '../openapi.ts'
import { record } from '../audit.ts'

const SyncResult = z
  .object({
    ok: z.boolean(),
    installations: z.number().int(),
    repositories: z.number().int(),
    removed: z.number().int().describe('Rows dropped because an installation no longer grants them'),
  })
  .strict()
  .meta({ ref: 'GitHubSyncResult' })

const RepositoriesResponse = z
  .object({ repositories: z.array(GitHubRepositoryView) })
  .strict()
  .meta({ ref: 'GitHubRepositoriesResponse' })

function seconds(date: Date | null): number | null {
  return date === null ? null : Math.floor(date.getTime() / 1000)
}



export function integrationRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  /**
   * Answers correctly when the integration is not configured at all, which is
   * the default. Never a token, a private key or a webhook secret.
   */
  app.get('/integrations/github', documentRoute({
    tag: 'Integrations', operationId: 'getGitHubIntegration', permission: 'github:read',
    summary: 'Report the GitHub App connection', response: GitHubIntegrationView,
    description: 'Reports configuration, reachability, installations, repository count, rate-limit budget and last sync. Secrets never appear here.',
    errors: [500],
  }), async (c) => {
    const status = githubStatus(deps)

    // The projection is read from the database, so it answers while GitHub is
    // down. A database that is down is a smaller answer, not an error.
    let installations: GitHubIntegrationView['installations'] = []
    let repositoryCount = 0
    let sync: GitHubIntegrationView['sync'] = []
    let projectionAvailable = false

    if (deps.db.status().available) {
      projectionAvailable = true
      const [rows, repositories, state] = await Promise.all([
        deps.db.github.listInstallations(),
        deps.db.github.listRepositories(),
        deps.db.github.listSyncState(),
      ])
      installations = rows.map((row) => ({
        installationId: row.installationId,
        accountLogin: row.accountLogin,
        accountType: row.accountType,
        suspended: row.suspended,
        permissions: row.permissions,
        syncedAt: seconds(row.syncedAt) ?? 0,
      }))
      repositoryCount = repositories.length
      sync = state.map((entry) => ({
        scope: entry.scope,
        lastSyncedAt: seconds(entry.lastSyncedAt),
        lastError: entry.lastError,
      }))
    }

    return c.json({ status, installations, repositoryCount, sync, projectionAvailable })
  })

  app.get('/integrations/github/repositories', documentRoute({
    tag: 'Integrations', operationId: 'listGitHubRepositories', permission: 'github:read',
    summary: 'List the repositories the App was granted', response: RepositoriesResponse,
    description: 'Served from the projection, so it answers while GitHub is unreachable. This list is also the authorisation boundary for every later operation.',
    errors: [500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const repositories = await db.github.listRepositories()
    return c.json({
      repositories: repositories.map((repository) => ({
        githubId: repository.githubId,
        installationId: repository.installationId,
        owner: repository.owner,
        name: repository.name,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
        private: repository.private,
        htmlUrl: repository.htmlUrl,
        archived: repository.archived,
        syncedAt: seconds(repository.syncedAt) ?? 0,
      })),
    })
  })

  app.post('/integrations/github/sync', documentRoute({
    tag: 'Integrations', operationId: 'syncGitHubIntegration', permission: 'github:sync',
    summary: 'Project installations and repositories', response: SyncResult,
    description: 'Idempotent: two runs leave the same rows and move syncedAt. Repositories an installation no longer grants are removed.',
    errors: [403, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    if (deps.github === null) {
      return c.json({ error: 'the GitHub App is not configured' }, 503)
    }
    // Which installations this host had before, so the two that are worth an
    // audit line — one appeared, one went away — can be told apart from the
    // repository counts a sync also moves.
    const before = new Set((await db.github.listInstallations()).map((row) => row.installationId))
    const result = await deps.github.sync(db)
    const after = await db.github.listInstallations()
    for (const installation of after) {
      if (before.has(installation.installationId)) continue
      await record(deps, c, {
        action: 'github.installed',
        resourceType: 'github-installation',
        resourceId: String(installation.installationId),
        resourceName: installation.accountLogin,
      })
    }
    const kept = new Set(after.map((row) => row.installationId))
    for (const installationId of before) {
      if (kept.has(installationId)) continue
      await record(deps, c, {
        action: 'github.removed',
        resourceType: 'github-installation',
        resourceId: String(installationId),
      })
    }
    // Issues follow the repositories they belong to: one button, one meaning.
    const runs = await reconcile(deps.github.require(), db)
    return c.json({
      ok: true,
      ...result,
      issues: runs.reduce((total, run) => total + run.issues, 0),
    })
  })

  /**
   * A delivery GitHub sent.
   *
   * **The signature is verified before the body is parsed as anything
   * meaningful.** The panel refuses every unsafe method without a same-origin
   * `Origin` header, and GitHub sends none; this route is the one deliberate
   * exemption from that guard, and the HMAC is what replaces it. An invalid
   * signature is a 401 that logs the delivery id and nothing else.
   *
   * A verified delivery is a signal to re-read, never data to trust: the
   * projection is only ever updated from what GitHub answered to a request the
   * panel made.
   */
  app.post('/integrations/github/webhook', documentRoute({
    tag: 'Integrations', operationId: 'receiveGitHubWebhook', public: true,
    summary: 'Receive a signed GitHub delivery',
    description: 'Verifies the HMAC signature before parsing. An unhandled event is acknowledged and dropped; an unverified one is refused.',
    response: z.object({
      ok: z.boolean(),
      action: z.enum(['sync-repository', 'sync-installations', 'ignored']),
      reason: z.string(),
    }).strict().meta({ ref: 'GitHubWebhookResult' }),
    errors: [401, 403, 500, 503],
  }), async (c) => {
    const raw = await c.req.text()
    const signature = c.req.header('x-hub-signature-256') ?? null
    const delivery = c.req.header('x-github-delivery') ?? 'unknown'

    if (!verifySignature(deps.config.githubWebhookSecret, raw, signature)) {
      // The delivery id, and nothing else: an unverified body is not logged.
      process.stderr.write(`github webhook: refused delivery ${delivery}\n`)
      return c.json({ error: 'the delivery signature could not be verified' }, 401)
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return c.json({ error: 'the delivery body is not JSON' }, 400 as 403)
    }

    const outcome = planDelivery(c.req.header('x-github-event') ?? '', payload)
    if (outcome.action === 'ignored' || deps.github === null || !deps.db.status().available) {
      return c.json({ ok: true, action: 'ignored', reason: outcome.reason })
    }

    const db = deps.db
    if (outcome.action === 'sync-installations') {
      await deps.github.sync(db)
    } else if (outcome.repository !== null) {
      const repository = await db.github.findRepository(outcome.repository)
      // A delivery for a repository the installation never granted changes
      // nothing: the projection is the boundary, deliveries do not widen it.
      if (repository) await syncRepositoryIssues(deps.github.require(), db, repository)
    }

    // The UI already invalidates on this hub for Docker events.
    deps.hub.publish({
      kind: 'config',
      action: 'github',
      id: null,
      name: outcome.repository,
      project: null,
      ownership: null,
      at: Math.floor(Date.now() / 1000),
    })
    return c.json({ ok: true, action: outcome.action, reason: outcome.reason })
  })

  return app
}
