// A Project's repositories: the decision (registered here), joined with the
// host scan (read from state/git) on every answer.
//
// Nothing here opens a directory or runs git. What the operator registers is
// a path and a name; whether the path is a repository, what branch it is on
// and which files instruct an agent are what `portta repos scan` collected.

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from '../../deps.ts'
import { requireDatabase, type Database } from '../../db/index.ts'
import type { RepositoryRow } from '../../db/repositories.ts'
import { OverrideRefused } from '../../services/overrides.ts'
import { readRepositoryScan } from '../../services/git.ts'
import { discoveredRepositories, environmentsOf, loadScans, toRepository } from '../../services/repositories.ts'
import { Commit, DiscoveredRepository, InstructionFile, Repository, RepositoryGit, RouteUrl } from 'portta-contracts'
import { documentRoute } from '../openapi.ts'
import { recordActivity } from '../../services/activity.ts'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { projectScope } from '../../services/access-control.ts'

const slugParameter = {
  name: 'slug', in: 'path' as const, required: true,
  description: 'The Project slug.', schema: { type: 'string' as const },
}
const idParameter = {
  name: 'id', in: 'path' as const, required: true,
  description: 'The repository id, as the panel minted it.', schema: { type: 'string' as const },
}

const RepositoriesResponse = z.object({ repositories: z.array(Repository) }).strict().meta({ ref: 'RepositoriesResponse' })
const DiscoveredResponse = z.object({ repositories: z.array(DiscoveredRepository) }).strict().meta({ ref: 'DiscoveredRepositoriesResponse' })
const CommitsResponse = z.object({ commits: z.array(Commit), collectedAt: z.number().nullable(), stale: z.boolean() }).strict().meta({ ref: 'RepositoryCommitsResponse' })
const InstructionsResponse = z.object({ instructions: z.array(InstructionFile), collectedAt: z.number().nullable(), stale: z.boolean() }).strict().meta({ ref: 'RepositoryInstructionsResponse' })

const RepositoryEnvironment = z.object({
  environment: z.string(),
  running: z.boolean(),
  serviceCount: z.number().int(),
  runningCount: z.number().int(),
  completedCount: z.number().int().optional(),
  unhealthyCount: z.number().int(),
  urls: z.array(RouteUrl),
}).strict().meta({ ref: 'RepositoryEnvironment' })
const EnvironmentsResponse = z.object({ environments: z.array(RepositoryEnvironment) }).strict().meta({ ref: 'RepositoryEnvironmentsResponse' })

const Role = z.string().max(32).nullable()

/**
 * Three ways to register: a scanned root the host discovered (`scanKey`), a
 * GitHub repository the App was granted (`githubRepositoryId` or
 * `githubFullName`), or the fields by hand. The first two fill in what they
 * know; anything given explicitly wins.
 */
const CreateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  role: Role.optional(),
  localPath: z.string().max(1024).nullable().optional(),
  relativePath: z.string().max(255).nullable().optional(),
  remoteUrl: z.string().max(512).nullable().optional(),
  scanKey: z.string().regex(/^[0-9a-f]{12}$/).optional().describe('A key from /api/repositories/discovered'),
  githubRepositoryId: z.string().regex(/^\d+$/).nullable().optional().describe('A projection id from the GitHub App'),
  githubFullName: z.string().min(3).max(200).optional().describe('owner/name, resolved through the projection'),
  position: z.number().int().min(0).optional(),
}).strict().meta({ ref: 'CreateRepositoryBody' })

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  role: Role.optional(),
  localPath: z.string().max(1024).nullable().optional(),
  relativePath: z.string().max(255).nullable().optional(),
  remoteUrl: z.string().max(512).nullable().optional(),
  githubRepositoryId: z.string().regex(/^\d+$/).nullable().optional(),
  githubFullName: z.string().min(3).max(200).nullable().optional(),
  position: z.number().int().min(0).optional(),
}).strict().meta({ ref: 'PatchRepositoryBody' })

const Removal = z.object({
  ok: z.boolean(),
  removed: z.string(),
  note: z.string(),
}).strict().meta({ ref: 'RepositoryRemoval' })

/** A Zod failure on a stored decision is the caller's mistake, said plainly. */
function refusedOnValidation<T>(work: () => Promise<T>): Promise<T> {
  return work().catch((error: unknown) => {
    if (error instanceof z.ZodError) {
      throw new OverrideRefused(error.issues.map((issue) => issue.message).join('; '))
    }
    throw error
  })
}

export function repositoryRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  /** A repository, and whether this caller reaches the Project that owns it. */
  async function requireRepository(c: Context, db: Database, id: string): Promise<RepositoryRow> {
    const row = await db.repositories.find(id)
    if (!row) throw new HTTPException(404, { message: `no repository '${id}'` })
    authorizeScope(c, projectScope(row.projectId))
    return row
  }

  /** The Project a route named, and whether this caller reaches it. */
  async function requireProject(c: Context, db: Database, slug: string) {
    const project = await db.projects.find(slug)
    if (!project) throw new HTTPException(404, { message: `no project '${slug}'` })
    authorizeScope(c, projectScope(project.id))
    return project
  }

  /** The projection is the authorisation boundary: a GitHub repository outside it is refused before it is stored. */
  async function resolveGitHub(db: Database, body: { githubRepositoryId?: string | null; githubFullName?: string | null }) {
    if (body.githubFullName) {
      const known = await db.github.findRepository(body.githubFullName)
      if (!known) {
        throw new OverrideRefused(
          `${body.githubFullName} is not a repository this gateway was granted`,
          'install the GitHub App on it, then run a sync; see docs/github.md',
        )
      }
      return known
    }
    if (body.githubRepositoryId) {
      const known = (await db.github.listRepositories()).find((repository) => repository.id === body.githubRepositoryId)
      if (!known) throw new OverrideRefused(`no GitHub repository '${body.githubRepositoryId}' in the projection`)
      return known
    }
    return null
  }

  async function refuseTakenGitHub(db: Database, githubRepositoryId: string, exceptId?: string) {
    const owner = await db.repositories.findByGitHub(githubRepositoryId)
    if (owner && owner.id !== exceptId) {
      throw new OverrideRefused(
        `that GitHub repository already belongs to repository '${owner.name}' of another Project`,
        'a GitHub repository belongs to one Project; unlink it there first',
      )
    }
  }

  app.get('/repositories/discovered', documentRoute({
    tag: 'Repositories', operationId: 'listDiscoveredRepositories', permission: 'repository:read',
    summary: 'Git roots the host scanned that no Project has registered',
    description: 'From the host scan index (portta repos scan). What "Add repository" offers. Empty when nothing was scanned.',
    response: DiscoveredResponse, errors: [500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    // Roots on the host that no Project registered. They belong to nothing, so
    // there is no membership to check and they are for `scope: 'all'` alone.
    if (principalOf(c).scope !== 'all') return c.json({ repositories: [] })
    const rows = await db.repositories.list()
    return c.json({ repositories: discoveredRepositories(rows, loadScans(deps.config)) })
  })

  app.get('/projects/:slug/repositories', documentRoute({
    tag: 'Repositories', operationId: 'listProjectRepositories', permission: 'repository:read',
    summary: "List a Project's repositories",
    description: 'Registered repositories joined with what the host scan collected: branch, HEAD, dirty state, the environments running from each.',
    response: RepositoriesResponse, parameters: [slugParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await requireProject(c, db, c.req.param('slug'))
    const scans = loadScans(deps.config)
    const rows = await db.repositories.list(project.id)
    return c.json({ repositories: rows.map((row) => toRepository(deps.config, row, scans)) })
  })

  app.post('/projects/:slug/repositories', documentRoute({
    tag: 'Repositories', operationId: 'createRepository', permission: 'repository:manage',
    summary: 'Register a repository on a Project',
    description: 'From a scanned root (scanKey), from the GitHub App projection (githubRepositoryId or githubFullName), or by hand. A GitHub repository belongs to one Project. Nothing is cloned, moved or fetched.',
    request: CreateBody, response: Repository, status: 201,
    parameters: [slugParameter], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await requireProject(c, db, c.req.param('slug'))
    const body = CreateBody.parse(await c.req.json())
    const scans = loadScans(deps.config)

    const scanned = body.scanKey ? scans.index?.repositories.find((entry) => entry.key === body.scanKey) ?? null : null
    if (body.scanKey && !scanned) throw new OverrideRefused(`no scanned repository with key ${body.scanKey}`, 'run `portta repos scan` on the host')
    const github = await resolveGitHub(db, body)
    if (github) await refuseTakenGitHub(db, github.id)

    const name = body.name ?? scanned?.name ?? github?.name
    if (!name) throw new OverrideRefused('a repository needs a name, a scanKey or a GitHub repository')
    const created = await refusedOnValidation(() => db.repositories.create(project.id, {
      name,
      role: body.role ?? null,
      localPath: body.localPath !== undefined ? body.localPath : scanned?.path ?? null,
      relativePath: body.relativePath !== undefined ? body.relativePath : scanned?.relativePath ?? null,
      remoteUrl: body.remoteUrl !== undefined ? body.remoteUrl : scanned?.remote ?? github?.htmlUrl ?? null,
      githubRepositoryId: github?.id ?? null,
      position: body.position ?? 0,
    }))
    const principal = principalOf(c)
    await recordActivity({ db, hub: deps.hub }, { kind: 'repository.added', actor: principal.actor, actorKind: principal.actorKind, project: project.slug, projectId: project.id, repositoryId: created.id, summary: `repository ${created.name} added to ${project.name}`, data: { provider: created.provider } })
    deps.hub.publish({ kind: 'repository', action: 'added', id: created.id, name: created.name, project: project.slug, ownership: null, at: Math.floor(Date.now() / 1000) })
    return c.json(toRepository(deps.config, created, scans), 201)
  })

  app.get('/repositories/:id', documentRoute({
    tag: 'Repositories', operationId: 'getRepository', permission: 'repository:read', summary: 'Get one repository',
    response: Repository, parameters: [idParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const row = await requireRepository(c, db, c.req.param('id'))
    return c.json(toRepository(deps.config, row, loadScans(deps.config)))
  })

  app.patch('/repositories/:id', documentRoute({
    tag: 'Repositories', operationId: 'patchRepository', permission: 'repository:manage', summary: 'Rename, place, re-point or re-link a repository',
    description: 'githubFullName or githubRepositoryId links the GitHub projection row; null unlinks it. Nothing on the host changes.',
    request: PatchBody, response: Repository, parameters: [idParameter], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const row = await requireRepository(c, db, c.req.param('id'))
    const body = PatchBody.parse(await c.req.json())
    const { githubFullName, ...rest } = body
    const patch: Record<string, unknown> = { ...rest }
    if (githubFullName !== undefined) {
      if (githubFullName === null) patch['githubRepositoryId'] = null
      else {
        const github = await resolveGitHub(db, { githubFullName })
        patch['githubRepositoryId'] = github!.id
      }
    }
    if (typeof patch['githubRepositoryId'] === 'string') {
      if (!githubFullName) await resolveGitHub(db, { githubRepositoryId: patch['githubRepositoryId'] })
      await refuseTakenGitHub(db, patch['githubRepositoryId'], row.id)
    }
    const updated = await refusedOnValidation(() => db.repositories.update(row.id, patch))
    if (!updated) throw new HTTPException(404, { message: `no repository '${row.id}'` })
    return c.json(toRepository(deps.config, updated, loadScans(deps.config)))
  })

  app.delete('/repositories/:id', documentRoute({
    tag: 'Repositories', operationId: 'deleteRepository', permission: 'repository:manage', summary: 'Unregister a repository',
    description: 'Removes the registration only. The clone on the host, the remote and the GitHub repository are untouched.',
    response: Removal, parameters: [idParameter], errors: [403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const row = await requireRepository(c, db, c.req.param('id'))
    await db.repositories.remove(row.id)
    const principal = principalOf(c)
    const slug = (await db.projects.list()).find((project) => project.id === row.projectId)?.slug ?? null
    await recordActivity({ db, hub: deps.hub }, { kind: 'repository.removed', actor: principal.actor, actorKind: principal.actorKind, project: slug, projectId: row.projectId, summary: `repository ${row.name} removed from the Project`, data: { name: row.name } })
    deps.hub.publish({ kind: 'repository', action: 'removed', id: row.id, name: row.name, project: slug, ownership: null, at: Math.floor(Date.now() / 1000) })
    return c.json({ ok: true, removed: row.name, note: 'the registration only: the clone, the remote and GitHub were not touched' })
  })

  function scanFor(row: RepositoryRow) {
    const repository = toRepository(deps.config, row, loadScans(deps.config))
    return { repository, scan: repository.scanKey ? readRepositoryScan(deps.config, repository.scanKey) : null }
  }

  app.get('/repositories/:id/git', documentRoute({
    tag: 'Repositories', operationId: 'getRepositoryGit', permission: 'repository:read',
    summary: 'Everything the host scan collected about a repository',
    description: 'Branch, HEAD, working tree, ahead/behind, remote, recent commits, instruction files and pull requests. A snapshot with an age; never live.',
    response: RepositoryGit, parameters: [idParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const { repository, scan } = scanFor(await requireRepository(c, db, c.req.param('id')))
    return c.json(scan ?? readRepositoryScan(deps.config, repository.scanKey ?? '000000000000'))
  })

  app.get('/repositories/:id/commits', documentRoute({
    tag: 'Repositories', operationId: 'listRepositoryCommits', permission: 'repository:read', summary: 'Recent commits, most recent first',
    response: CommitsResponse, parameters: [idParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const { scan } = scanFor(await requireRepository(c, db, c.req.param('id')))
    return c.json({ commits: scan?.commits ?? [], collectedAt: scan?.collectedAt ?? null, stale: scan?.stale ?? false })
  })

  app.get('/repositories/:id/instructions', documentRoute({
    tag: 'Repositories', operationId: 'listRepositoryInstructions', permission: 'repository:read',
    summary: 'The instruction files an agent reads in this repository',
    description: 'AGENTS.md, CLAUDE.md, .cursor/rules and the rest of the allowlist, with content when it fits the bound and whether the working tree differs from HEAD.',
    response: InstructionsResponse, parameters: [idParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const { scan } = scanFor(await requireRepository(c, db, c.req.param('id')))
    return c.json({ instructions: scan?.instructions ?? [], collectedAt: scan?.collectedAt ?? null, stale: scan?.stale ?? false })
  })

  app.get('/repositories/:id/environments', documentRoute({
    tag: 'Repositories', operationId: 'listRepositoryEnvironments', permission: 'repository:read',
    summary: 'The environments running from this repository',
    response: EnvironmentsResponse, parameters: [idParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const { repository } = scanFor(await requireRepository(c, db, c.req.param('id')))
    return c.json({ environments: environmentsOf(repository, await deps.cache.get()) })
  })

  return app
}
