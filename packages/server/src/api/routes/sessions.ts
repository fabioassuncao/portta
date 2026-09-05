// Development sessions: a person or an agent working on a task, in a
// repository, in an environment, from a moment to a moment.

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from '../../deps.ts'
import { requireDatabase, type Database } from '../../db/index.ts'
import { StartSession, UpdateSession } from '../../db/work-sessions.ts'
import { OverrideRefused } from '../../services/overrides.ts'
import { loadNames, sessionView } from '../../services/activity-view.ts'
import { recordActivity } from '../../services/activity.ts'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { projectScope } from '../../services/access-control.ts'
import { Session } from 'portta-contracts'
import { documentRoute } from '../openapi.ts'
import { actorHeader } from './tasks.ts'

const SessionsResponse = z.object({ sessions: z.array(Session) }).strict().meta({ ref: 'SessionsResponse' })
const StartSessionBody = StartSession.omit({ actor: true, actorKind: true, environmentId: true }).extend({
  environment: z.string().max(255).nullable().optional().describe('COMPOSE_PROJECT_NAME'),
}).strict().meta({ ref: 'StartSessionBody' })
const UpdateSessionBody = UpdateSession.omit({ environmentId: true }).extend({
  environment: z.string().max(255).nullable().optional(),
}).strict().meta({ ref: 'UpdateSessionBody' })

const slugParameter = { name: 'slug', in: 'path' as const, required: true, description: 'The Project slug.', schema: { type: 'string' as const } }
const idParameter = { name: 'id', in: 'path' as const, required: true, description: 'The session id.', schema: { type: 'string' as const } }

export function sessionRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  /**
   * The Project a route named, and whether this caller reaches it.
   *
   * Both halves together, deliberately: a lookup that returned the row without
   * asking would be one `authorizeScope` away from a leak, and forgetting it is
   * exactly the mistake nothing else catches.
   */
  async function requireProject(c: Context, db: Database, slug: string) {
    const project = await db.projects.find(slug)
    if (!project) throw new HTTPException(404, { message: `no project '${slug}'` })
    authorizeScope(c, projectScope(project.id))
    return project
  }

  async function environmentIdOf(db: Database, name: string | null | undefined): Promise<string | null | undefined> {
    if (name === undefined) return undefined
    if (name === null) return null
    const record = await db.environments.find(name)
    if (!record) throw new OverrideRefused(`no environment '${name}' is known to this panel`)
    return record.id
  }

  async function present(db: Database, id: string): Promise<Session> {
    const row = await db.sessions.find(id)
    if (!row) throw new HTTPException(404, { message: `no session '${id}'` })
    return sessionView(await loadNames(db), row)
  }

  app.get('/projects/:slug/sessions', documentRoute({
    tag: 'Sessions', operationId: 'listProjectSessions', permission: 'worksession:read', summary: "A Project's sessions, most recent first",
    response: SessionsResponse, parameters: [slugParameter, { name: 'active', in: 'query', required: false, description: 'true for active sessions only.', schema: { type: 'string' } }],
    errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await requireProject(c, db, c.req.param('slug'))
    const active = new URL(c.req.url).searchParams.get('active') === 'true'
    const names = await loadNames(db)
    const rows = await db.sessions.list({ projectId: project.id, ...(active ? { status: ['active'] } : {}) })
    return c.json({ sessions: rows.map((row) => sessionView(names, row)) })
  })

  app.post('/projects/:slug/sessions', documentRoute({
    tag: 'Sessions', operationId: 'startSession', permission: 'worksession:write', summary: 'Start a session',
    description: 'The actor is X-Portta-Actor, or the operator. An agent’s session is an agent session.',
    request: StartSessionBody, response: Session, status: 201, parameters: [slugParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await requireProject(c, db, c.req.param('slug'))
    const body = StartSessionBody.parse(await c.req.json().catch(() => ({})))
    const principal = principalOf(c)
    const { environment, ...rest } = body
    const environmentId = await environmentIdOf(db, environment)
    if (rest.taskId) {
      const task = await db.tasks.find(rest.taskId)
      if (!task || task.projectId !== project.id) throw new OverrideRefused('that task does not belong to this Project')
    }
    const actor = principal.actor ?? 'operator'
    const row = await db.sessions.start(project.id, { ...rest, ...(environmentId !== undefined ? { environmentId } : {}), agent: rest.agent ?? (principal.actorKind === 'agent' ? principal.actor : null) }, actor, principal.actorKind)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'session.started', actor, actorKind: principal.actorKind, project: project.slug,
      projectId: project.id, taskId: row.taskId, repositoryId: row.repositoryId, environmentId: row.environmentId, sessionId: row.id,
      summary: `${actor} started working${row.summary ? `: ${row.summary}` : ''}`,
    })
    deps.hub.publish({ kind: 'session', action: 'started', id: row.id, name: actor, project: project.slug, ownership: null, at: Math.floor(Date.now() / 1000) })
    return c.json(await present(db, row.id), 201)
  })

  app.get('/sessions/:id', documentRoute({
    tag: 'Sessions', operationId: 'getSession', permission: 'worksession:read', summary: 'One session',
    response: Session, parameters: [idParameter], errors: [404, 500, 503],
  }), async (c) => c.json(await present(requireDatabase(deps.db), c.req.param('id'))))

  app.patch('/sessions/:id', documentRoute({
    tag: 'Sessions', operationId: 'updateSession', permission: 'worksession:write', summary: 'Heartbeat, end, or describe a session',
    description: 'Any patch is a heartbeat. Only the session’s own actor, or the operator, may end it.',
    request: UpdateSessionBody, response: Session, parameters: [idParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const current = await db.sessions.find(c.req.param('id'))
    if (!current) throw new HTTPException(404, { message: `no session '${c.req.param('id')}'` })
    const body = UpdateSessionBody.parse(await c.req.json().catch(() => ({})))
    const principal = principalOf(c)
    if (body.status && body.status !== 'active' && principal.actorKind === 'agent' && principal.actor !== current.actor) {
      throw new HTTPException(403, { message: `only ${current.actor} or the operator may end this session` })
    }
    const wasActive = current.status === 'active'
    const { environment, ...rest } = body
    const environmentId = await environmentIdOf(db, environment)
    const updated = await db.sessions.update(current.id, { ...rest, ...(environmentId !== undefined ? { environmentId } : {}) })
    if (!updated) throw new HTTPException(404, { message: `no session '${current.id}'` })
    if (wasActive && updated.status !== 'active') {
      const slug = (await db.projects.list()).find((project) => project.id === updated.projectId)?.slug ?? null
      await recordActivity({ db, hub: deps.hub }, {
        kind: updated.status === 'ended' ? 'session.ended' : 'session.abandoned', actor: principal.actor ?? updated.actor, actorKind: principal.actorKind, project: slug,
        projectId: updated.projectId, taskId: updated.taskId, repositoryId: updated.repositoryId, environmentId: updated.environmentId, sessionId: updated.id,
        summary: `${updated.actor} stopped working${updated.summary ? `: ${updated.summary}` : ''}`,
        data: { commits: updated.commits.length },
      })
      deps.hub.publish({ kind: 'session', action: updated.status, id: updated.id, name: updated.actor, project: slug, ownership: null, at: Math.floor(Date.now() / 1000) })
    }
    return c.json(await present(db, updated.id))
  })

  return app
}
