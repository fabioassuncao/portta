import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from '../../deps.ts'
import { requireDatabase, type Database } from '../../db/index.ts'
import type { StoredIssue } from '../../db/github.ts'
import { OverrideRefused } from '../../services/overrides.ts'
import {
  isPriority,
  isWorkflowStatus,
  labelsAfter,
} from '../../services/integrations/github/metadata.ts'
import { normaliseIssue, type RawIssue } from '../../services/integrations/github/issues.ts'
import { applyIssueToTask } from '../../services/integrations/github/tasks.ts'
import { environmentsFor } from '../../services/issue-environments.ts'
import { issueView as view, resolvedLinks as linksFor } from '../../services/issue-view.ts'
import { recordActivity } from '../../services/activity.ts'
import { principalOf } from 'portta-auth-core/hono'
import { Issue } from 'portta-contracts'
import { documentRoute } from '../openapi.ts'
import { authorizeScope } from 'portta-auth-core/hono'
import { projectScope } from '../../services/access-control.ts'

const IssuesResponse = z.object({ issues: z.array(Issue) }).strict().meta({ ref: 'IssuesResponse' })

const PatchIssueBody = z
  .object({
    status: z.enum(['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done']).nullable().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable().optional(),
    state: z.enum(['open', 'closed']).optional(),
    assignees: z.array(z.string().min(1)).max(10).optional(),
    labels: z.array(z.string().min(1)).max(100).optional(),
  })
  .strict()
  .meta({ ref: 'PatchIssueBody' })

const issueIdParameter = {
  name: 'id',
  in: 'path' as const,
  required: true,
  description: 'The projected issue id, not the GitHub number.',
  schema: { type: 'string' as const },
}

/** Repositories one Project owns, as projection ids. */
async function projectRepositoryIds(db: Database, slug: string): Promise<string[]> {
  const project = await db.projects.find(slug)
  if (!project) throw new HTTPException(404, { message: `no project '${slug}'` })
  const rows = await db.repositories.list(project.id)
  return rows.flatMap((row) => (row.githubRepositoryId ? [row.githubRepositoryId] : []))
}

/**
 * Which Project a projected issue belongs to, through the repository somebody
 * registered.
 *
 * `null` means the repository is in the projection but no Project registered
 * it: the GitHub App was granted it and nobody claimed it here. Those are
 * global — visible to whoever sees everything (03 §4.5).
 */
async function projectOfIssue(db: Database, repositoryFullName: string): Promise<number | null> {
  const projected = await db.github.findRepository(repositoryFullName)
  if (!projected) return null
  const registered = (await db.repositories.list()).find((row) => row.githubRepositoryId === projected.id)
  return registered ? projectScope(registered.projectId) : null
}

function matches(issue: StoredIssue, query: URLSearchParams): boolean {
  const equals = (key: string, value: string | null) => {
    const wanted = query.get(key)
    return wanted === null || (value !== null && value.toLowerCase() === wanted.toLowerCase())
  }

  if (!equals('repository', issue.repository)) return false
  if (!equals('state', issue.state)) return false
  if (!equals('status', issue.workflowStatus)) return false
  if (!equals('priority', issue.priority)) return false
  if (!equals('type', issue.issueType)) return false

  const assignee = query.get('assignee')
  if (assignee !== null && !issue.assignees.some((login) => login.toLowerCase() === assignee.toLowerCase())) {
    return false
  }
  const label = query.get('label')
  if (label !== null && !issue.labels.some((name) => name.toLowerCase() === label.toLowerCase())) {
    return false
  }
  const milestone = query.get('milestone')
  if (milestone !== null && (issue.milestone?.title ?? '').toLowerCase() !== milestone.toLowerCase()) {
    return false
  }
  const text = query.get('q')
  if (text !== null && !`${issue.number} ${issue.title}`.toLowerCase().includes(text.toLowerCase())) {
    return false
  }
  return true
}

const FILTERS = [
  ['repository', 'Filter by owner/name.'],
  ['state', 'open or closed.'],
  ['status', 'backlog, ready, in_progress, review, blocked or done.'],
  ['priority', 'low, medium, high or urgent.'],
  ['type', "GitHub's issue type, where the repository has them."],
  ['assignee', 'GitHub login.'],
  ['milestone', 'Milestone title.'],
  ['label', 'Exact label name.'],
  ['q', 'Substring of the number or title.'],
] as const

const filterParameters = FILTERS.map(([name, description]) => ({
  name,
  in: 'query' as const,
  required: false,
  description,
  schema: { type: 'string' as const },
}))

export function issueRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function listing(db: Database, repositoryIds: string[] | undefined, query: URLSearchParams) {
    const [issues, relationships, snapshot] = await Promise.all([
      db.github.listIssues({ repositoryIds, state: query.get('state') ?? undefined }),
      db.github.listRelationships(),
      deps.cache.get(),
    ])
    const links = await linksFor(deps.config, db, snapshot)
    const now = Math.floor(Date.now() / 1000)
    return issues
      .filter((issue) => matches(issue, query))
      .map((issue) => view(issue, relationships, now, environmentsFor(issue.id, snapshot, links)))
  }

  app.get('/projects/:slug/issues', documentRoute({
    tag: 'Issues', operationId: 'listProjectIssues', permission: 'github:read',
    summary: "List issues across a Project's repositories", response: IssuesResponse,
    description: 'Served from the projection, so it answers while GitHub is unreachable; every row carries syncedAt and a staleness flag.',
    parameters: [
      { name: 'slug', in: 'path', required: true, description: 'The Project slug.', schema: { type: 'string' } },
      ...filterParameters,
    ],
    errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await db.projects.find(c.req.param('slug'))
    if (!project) throw new HTTPException(404, { message: `no project '${c.req.param('slug')}'` })
    authorizeScope(c, projectScope(project.id))
    const repositoryIds = await projectRepositoryIds(db, c.req.param('slug'))
    const query = new URL(c.req.url).searchParams
    return c.json({ issues: repositoryIds.length === 0 ? [] : await listing(db, repositoryIds, query) })
  })

  app.get('/issues', documentRoute({
    tag: 'Issues', operationId: 'listIssues', permission: 'github:read', summary: 'List projected issues',
    response: IssuesResponse, parameters: filterParameters, errors: [500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const principal = principalOf(c)
    // Everything, or exactly the repositories the visible Projects registered.
    // An issue whose repository nobody registered has no Project to belong to.
    if (principal.scope === 'all') {
      return c.json({ issues: await listing(db, undefined, new URL(c.req.url).searchParams) })
    }
    const rows = await db.repositories.list()
    const reachable = rows.flatMap((row) =>
      row.githubRepositoryId && principal.scope !== 'all' && principal.scope.has(projectScope(row.projectId)!)
        ? [row.githubRepositoryId]
        : [],
    )
    return c.json({ issues: reachable.length === 0 ? [] : await listing(db, reachable, new URL(c.req.url).searchParams) })
  })

  app.get('/issues/:id', documentRoute({
    tag: 'Issues', operationId: 'getIssue', permission: 'github:read', summary: 'Get one issue with its sub-issue links',
    response: Issue, parameters: [issueIdParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const issue = await db.github.findIssue(c.req.param('id'))
    if (!issue) throw new HTTPException(404, { message: `no issue '${c.req.param('id')}'` })
    authorizeScope(c, await projectOfIssue(db, issue.repository))
    const relationships = await db.github.listRelationships()
    const snapshot = await deps.cache.get()
    const links = await linksFor(deps.config, db, snapshot)
    return c.json(
      view(issue, relationships, Math.floor(Date.now() / 1000), environmentsFor(issue.id, snapshot, links)),
    )
  })

  /**
   * Writes through to GitHub, then updates the projection from GitHub's answer.
   *
   * Never from what was requested: the panel must not show an issue GitHub did
   * not confirm. A repository outside the installation is refused before a
   * request leaves, and the response says which mechanism carried the change,
   * because writing a status through labels shows in the issue's timeline.
   */
  app.patch('/issues/:id', documentRoute({
    tag: 'Issues', operationId: 'patchIssue', permission: 'task:sync', summary: 'Change an issue on GitHub',
    description: 'Writes to GitHub and updates the projection from the response. Refused in read-only mode and for a repository outside the installation.',
    request: PatchIssueBody, response: Issue,
    parameters: [issueIdParameter], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const github = deps.github
    if (github === null || !github.status().configured) {
      throw new OverrideRefused(
        'the GitHub App is not configured, so nothing can be written back',
        'see docs/github.md',
      )
    }

    const issue = await db.github.findIssue(c.req.param('id'))
    if (!issue) throw new HTTPException(404, { message: `no issue '${c.req.param('id')}'` })
    authorizeScope(c, await projectOfIssue(db, issue.repository))

    // The projection is the authorisation boundary: an issue whose repository
    // is no longer granted cannot be written.
    const repository = await db.github.findRepository(issue.repository)
    if (!repository) {
      throw new OverrideRefused(`${issue.repository} is not a repository this gateway was granted`)
    }

    const body = PatchIssueBody.parse(await c.req.json())
    const patch: Record<string, unknown> = {}
    if (body.state) patch['state'] = body.state
    if (body.assignees) patch['assignees'] = body.assignees

    const wantsStatus = Object.hasOwn(body, 'status')
    const wantsPriority = Object.hasOwn(body, 'priority')
    if (wantsStatus || wantsPriority) {
      patch['labels'] = labelsAfter(body.labels ?? issue.labels, {
        ...(wantsStatus ? { status: body.status ?? null } : {}),
        ...(wantsPriority ? { priority: body.priority ?? null } : {}),
      })
    } else if (body.labels) {
      patch['labels'] = body.labels
    }

    if (Object.keys(patch).length === 0) {
      throw new OverrideRefused('nothing to change')
    }

    const client = github.require()
    const updated = await client.patchAsInstallation<RawIssue>(
      repository.installationId,
      `/repos/${issue.repository}/issues/${issue.number}`,
      patch,
    )

    const record = normaliseIssue(updated.data, issue.repositoryId)
    await db.github.upsertIssue(record)

    const fresh = await db.github.findIssue(issue.id)
    // The bound task, if there is one, follows what GitHub confirmed.
    if (fresh) {
      const applied = await applyIssueToTask(db.tasks, fresh, async (githubRepositoryId) => {
        const owner = await db.repositories.findByGitHub(githubRepositoryId)
        return owner ? { projectId: owner.projectId, repositoryId: owner.id } : null
      })
      if (applied.task) {
        const principal = principalOf(c)
        await recordActivity({ db, hub: deps.hub }, {
          kind: 'task.synced', actor: principal.actor, actorKind: principal.actorKind, source: principal.source,
          projectId: applied.task.projectId, taskId: applied.task.id, repositoryId: applied.task.repositoryId,
          summary: `${issue.repository}#${issue.number} changed on GitHub and the task followed`,
          data: { outcome: applied.outcome },
        })
      }
    }
    const relationships = await db.github.listRelationships()
    const snapshot = await deps.cache.get()
    const links = await linksFor(deps.config, db, snapshot)
    deps.hub.publish({
      kind: 'config',
      action: 'issue',
      id: issue.id,
      name: `${issue.repository}#${issue.number}`,
      project: null,
      ownership: null,
      at: Math.floor(Date.now() / 1000),
    })
    return c.json(
      view(
        fresh ?? issue,
        relationships,
        Math.floor(Date.now() / 1000),
        environmentsFor(issue.id, snapshot, links),
      ),
    )
  })

  return app
}

export { isPriority, isWorkflowStatus }
