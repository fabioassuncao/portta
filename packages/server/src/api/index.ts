// The panel's HTTP surface: a small API, and the built UI beside it.

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from '../deps.ts'
import { statusRoutes } from './routes/status.ts'
import { environmentRoutes } from './routes/environments.ts'
import { runnerRoutes } from './routes/runner.ts'
import { overrideRoutes } from './routes/overrides.ts'
import { projectRoutes } from './routes/projects.ts'
import { repositoryRoutes } from './routes/repositories.ts'
import { serviceRoutes } from './routes/services.ts'
import { dockerRoutes } from './routes/docker.ts'
import { networkRoutes } from './routes/network.ts'
import { tunnelRoutes } from './routes/tunnel.ts'
import { accessRoutes } from './routes/access.ts'
import { gatewayRoutes } from './routes/gateway.ts'
import { hostRoutes } from './routes/host.ts'
import { configRoutes } from './routes/config.ts'
import { databaseRoutes } from './routes/database.ts'
import { eventRoutes } from '../realtime/sse.ts'
import { integrationRoutes } from './routes/integrations.ts'
import { issueRoutes } from './routes/issues.ts'
import { taskRoutes } from './routes/tasks.ts'
import { taskGitHubRoutes } from './routes/task-github.ts'
import { sessionRoutes } from './routes/sessions.ts'
import { activityRoutes } from './routes/activity.ts'
import { developmentRoutes } from './routes/development.ts'
import { authRoutes } from './routes/auth.ts'
import { userRoutes } from './routes/users.ts'
import { tokenRoutes } from './routes/tokens.ts'
import { auditRoutes } from './routes/audit.ts'
import { AUDITED_AUTH_PATHS, auditAuthExchange } from '../services/audit-auth.ts'
import { settingsRoutes } from './routes/settings.ts'
import { Forbidden, hasOwner, TokenRefused, Unauthenticated } from 'portta-auth-core'
import { principalMiddleware, SetupRequired } from 'portta-auth-core/hono'
import { shareRoutes } from './routes/shares.ts'
import { ActionRefused } from '../services/actions.ts'
import { AccessError } from '../services/access.ts'
import { ShareRefused } from '../services/shares.ts'
import { OverrideRefused } from '../services/overrides.ts'
import { DynamicWriteRefused } from '../services/dynamic.ts'
import { ValidationError } from '../services/settings.ts'
import { DockerApiError } from '../services/docker/client.ts'
import { DockerAccessDenied } from '../services/docker/allowlist.ts'
import { ZodError } from 'zod'
import { registerOpenApiRoutes } from './openapi.ts'
import { DatabaseUnavailable } from '../db/index.ts'
import { UnknownUser, UserRefused, UsersUnavailable } from '../services/users.ts'
import { GitHubForbidden, GitHubUnavailable } from '../services/integrations/github/index.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * What answers without a credential.
 *
 * Four routes, named in full because the set is the security boundary: adding
 * to it is a decision, and reading it should not require reading the routers.
 * Liveness, the status a browser needs before it knows which page to show, the
 * bootstrap that has nobody to authenticate as yet, and the GitHub delivery,
 * which carries an HMAC instead of a session.
 */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'GET /api/health',
  'GET /api/auth/status',
  'POST /api/auth/setup',
  'POST /api/integrations/github/webhook',
])

/** The one delivery with no Origin and no session: GitHub signs it instead. */
const WEBHOOK_PATH = '/api/integrations/github/webhook'

/**
 * The paths under `/api/auth` that are Portta's, not Better Auth's.
 *
 * Everything else there is handed to the library untouched. Naming ours is what
 * keeps that hand-off total: a path that is not in this set is the library's,
 * whatever it is called and whenever it was added.
 */
const PORTTA_AUTH_PATHS: ReadonlySet<string> = new Set([
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/me',
  '/api/auth/tokens',
])

/** Ours, or the library's. `/tokens/:id` is ours too, hence the prefix. */
function isPorttaAuthPath(path: string): boolean {
  return PORTTA_AUTH_PATHS.has(path) || path.startsWith('/api/auth/tokens/')
}

/**
 * A page on another site can point a form or a fetch at 127.0.0.1. Reads are
 * harmless enough behind loopback; a write is not, so one has to come from the
 * panel itself.
 */
function originAllowed(origin: string, host: string, trusted: readonly string[]): boolean {
  if (origin === '') return true
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.host === host) return true
  if (trusted.includes(parsed.origin)) return true
  return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
}

export function createApi(deps: AppDeps): Hono {
  const api = new Hono()

  // Better Auth's own endpoints, before the principal is resolved: sign-in has
  // nobody to be yet. The request is handed over as it arrived and the library's
  // response is returned as it came back, cookies and all, because that contract
  // is the library's to define.
  //
  // In open mode `deps.auth` is null and this never registers, so `/api/auth/*`
  // falls through to the 404 at the bottom -- except for the two of ours that
  // still answer, which is what a browser needs to learn there is no sign-in.
  const auth = deps.auth
  if (auth) {
    api.use('/auth/*', async (c, next) => {
      if (isPorttaAuthPath(c.req.path)) return next()
      // The request is read twice: once here, to know which email a failed
      // sign-in was for, and once by the library. `c.req.raw` is cloned rather
      // than consumed, because a body read to the end is a body the handler
      // would receive empty.
      const body = c.req.method === 'POST'
        ? await c.req.raw.clone().json().catch(() => null)
        : null
      const response = await auth.handler(c.req.raw)
      // The audit line is written from a copy for the same reason.
      const seen = AUDITED_AUTH_PATHS.has(c.req.path)
      const answered = seen ? await response.clone().json().catch(() => null) as { user?: { id: string; email: string; name: string } } | null : null
      if (seen) {
        void auditAuthExchange(deps.db.handle, {
          path: c.req.path,
          status: response.status,
          body,
          headers: c.req.raw.headers,
          user: answered?.user ?? null,
        })
      }
      return response
    })
  }

  // Who is asking, before any route: in open mode the local operator, narrowed
  // to what agents hold when the request says it is one; in protected mode a
  // session cookie or a Portta token, and nothing at all without one.
  api.use('*', principalMiddleware({
    resolver: deps.principals,
    publicRoutes: PUBLIC_ROUTES,
    setupRequired: deps.security.mode === 'open' ? undefined : async () => !(await hasOwner(deps.db.handle)),
  }))

  api.use('*', async (c, next) => {
    c.header('cache-control', 'no-store')
    c.header('x-content-type-options', 'nosniff')

    if (!SAFE_METHODS.has(c.req.method)) {
      // Applying pending SQL is what boot already does. Read-only forbids
      // operator writes, not bringing the schema current.
      const isSchemaMigrate = c.req.path.endsWith('/database/migrate')
      if (deps.config.readOnly && !isSchemaMigrate) {
        throw new HTTPException(403, { message: 'the panel is running in read-only mode' })
      }
      // GitHub sends no Origin header, so the one route that receives its
      // deliveries is exempt from this guard — narrowly, by exact path, and
      // only because an HMAC signature over the raw body replaces it. Nothing
      // else is exempt, and read-only mode above still refuses it.
      const isWebhook = c.req.path === WEBHOOK_PATH
      const origin = c.req.header('origin') ?? ''
      const host = c.req.header('host') ?? ''
      if (!isWebhook && !originAllowed(origin, host, deps.security.trustedOrigins)) {
        throw new HTTPException(403, { message: 'cross-origin writes are refused' })
      }
    }
    await next()
  })

  api.route('/', statusRoutes(deps))
  api.route('/', environmentRoutes(deps))
  api.route('/', runnerRoutes(deps))
  api.route('/', overrideRoutes(deps))
  api.route('/', projectRoutes(deps))
  api.route('/', repositoryRoutes(deps))
  api.route('/', serviceRoutes(deps))
  api.route('/', dockerRoutes(deps))
  api.route('/', networkRoutes(deps))
  api.route('/', tunnelRoutes(deps))
  api.route('/', accessRoutes(deps))
  api.route('/', shareRoutes(deps))
  api.route('/', gatewayRoutes(deps))
  api.route('/', hostRoutes(deps))
  api.route('/', configRoutes(deps))
  api.route('/', databaseRoutes(deps))
  api.route('/', eventRoutes(deps))
  api.route('/', integrationRoutes(deps))
  api.route('/', issueRoutes(deps))
  api.route('/', taskRoutes(deps))
  api.route('/', taskGitHubRoutes(deps))
  api.route('/', sessionRoutes(deps))
  api.route('/', activityRoutes(deps))
  api.route('/', developmentRoutes(deps))
  api.route('/', authRoutes(deps))
  api.route('/', userRoutes(deps))
  api.route('/', tokenRoutes(deps))
  api.route('/', auditRoutes(deps))
  api.route('/', settingsRoutes(deps))
  registerOpenApiRoutes(api, deps.config)

  api.all('*', (c) => c.json({ error: `no such endpoint: ${c.req.path}` }, 404))

  return api
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status)
    }
    // The distinction is the contract: 401 means "say who you are", 403 means
    // "you did, and it is not enough". A client that cannot tell them apart
    // either retries forever or gives up on a credential that was fine.
    if (error instanceof Unauthenticated) {
      return c.json({ error: error.message, hint: 'sign in, or send a Portta token' }, 401)
    }
    if (error instanceof Forbidden) {
      return c.json({ error: error.message, hint: `this needs ${error.permission}` }, 403)
    }
    // A panel with no owner answers nothing about the host it runs on.
    if (error instanceof SetupRequired) {
      return c.json({ error: error.message, code: 'setup_required', hint: 'open /setup to create the owner' }, 503)
    }
    if (
      error instanceof ActionRefused ||
      error instanceof AccessError ||
      error instanceof ShareRefused ||
      error instanceof OverrideRefused ||
      error instanceof DynamicWriteRefused
    ) {
      return c.json({ error: error.message, hint: error.hint }, error.status as 400)
    }
    // A token asking for more than its owner holds is the caller's mistake, and
    // the message names exactly what did not fit.
    if (error instanceof TokenRefused) {
      return c.json({ error: error.message, hint: error.hint }, 400)
    }
    // A rule about accounts, not a missing permission: the message says which
    // rule, because "403" alone sends somebody looking for the wrong thing.
    if (error instanceof UserRefused) {
      return c.json({ error: error.message, hint: error.hint }, 403)
    }
    if (error instanceof UnknownUser) {
      return c.json({ error: error.message }, 404)
    }
    if (error instanceof UsersUnavailable) {
      return c.json({ error: error.message, hint: error.hint }, 503)
    }
    if (error instanceof ValidationError) {
      return c.json({ error: error.message, hint: 'the value was not saved' }, 400)
    }
    // A body that does not match its schema is the caller's mistake, not a
    // server failure. It reached the 500 branch before, which told an agent to
    // retry something that will never succeed.
    if (error instanceof ZodError) {
      return c.json({
        error: error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '),
        hint: 'the request body did not match the documented schema',
      }, 400)
    }
    if (error instanceof DatabaseUnavailable) {
      return c.json(
        { error: error.message, hint: 'existing Docker-backed pages remain available; run portta db status' },
        503,
      )
    }
    // GitHub degrades the way the database does: a 503 with a hint on the
    // GitHub routes, and no effect anywhere else.
    if (error instanceof GitHubUnavailable) {
      return c.json({ error: error.message, hint: error.hint }, 503)
    }
    if (error instanceof GitHubForbidden) {
      return c.json({ error: error.message, hint: error.hint }, 403)
    }
    if (error instanceof DockerAccessDenied) {
      return c.json({ error: error.message, hint: 'this is a panel limit, not a Docker one' }, 403)
    }
    if (error instanceof DockerApiError) {
      const status = error.status >= 400 && error.status <= 599 ? error.status : 502
      return c.json({ error: error.message }, status as 502)
    }
    return c.json({ error: 'unexpected failure', detail: String(error) }, 500)
  })

  // `/api` and nothing else. The documentation is a route of the panel now
  // (`app/docs`), and everything that is not the API reaches Next through the
  // dispatcher in apps/web/server/compose.ts.
  app.route('/api', createApi(deps))
  return app
}

export type { AppDeps }
