// The task verbs, over Portta's own tasks.
//
// A task is local. It exists without GitHub; a GitHub issue is an optional
// binding on it (routes/task-github.ts). Every write here lands locally first
// and, when the task is bound and the App can be used, on GitHub second, with
// the binding saying which of the two it managed. An agent and the board see
// the same rows through the same views (core/task-view.ts).

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { ExampleDocument, TASK_DRAFT_MAX_AGE_MS, TASK_DRAFT_TITLE, TASK_PRIORITIES, TASK_STATUSES, finishPlan, nextTask, shouldPromoteDraft, startPlan, subtaskTree, type SchedulableTask } from 'portta-core'
import type { AppDeps } from '../../deps.ts'
import { requireDatabase, type Database } from '../../db/index.ts'
import type { TaskRow } from '../../db/tasks.ts'
import { OverrideRefused } from '../../services/overrides.ts'
import { attachmentView, loadTaskContext, taskSummaries, taskSummary, taskView, noteView, type TaskContext } from '../../services/task-view.ts'
import { ATTACHMENT_LIMITS, contentDisposition, normaliseContentType, rejectUpload, safeFilename } from '../../services/attachments.ts'
import { pushToGitHub, resolveTask, type TaskChange } from '../../services/task-write.ts'
import { recordActivity } from '../../services/activity.ts'
import { applyExampleDocument, exportProjectTasks } from '../../services/task-example-apply.ts'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { projectScope, visible } from '../../services/access-control.ts'
import type { Principal } from 'portta-auth-core'
import { Task, TaskAttachment, TaskNote, TaskSummary } from 'portta-contracts'
import { documentRoute } from '../openapi.ts'

const TasksResponse = z.object({ tasks: z.array(TaskSummary) }).strict().meta({ ref: 'TasksResponse' })
/** `null` rather than 404: "nothing to do" is an answer, not a missing thing. */
const NextTaskResponse = z.object({ task: Task.nullable() }).strict().meta({ ref: 'NextTaskResponse' })
const SubtaskNode: z.ZodType = z.lazy(() => z.object({ task: TaskSummary, children: z.array(SubtaskNode) }).strict())
const SubtasksResponse = z.object({ subtasks: z.array(SubtaskNode) }).strict().meta({ ref: 'SubtasksResponse' })
const NotesResponse = z.object({ notes: z.array(TaskNote) }).strict().meta({ ref: 'TaskNotesResponse' })
const CommentsResponse = z.object({ comments: z.array(TaskNote) }).strict().meta({ ref: 'TaskCommentsResponse' })
const AttachmentsResponse = z.object({ attachments: z.array(TaskAttachment) }).strict().meta({ ref: 'TaskAttachmentsResponse' })
const OkResponse = z.object({ ok: z.boolean() }).strict().meta({ ref: 'TaskOkResponse' })

const LocalId = z.string().regex(/^\d+$/)
const CreateTaskBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(65536).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).nullable().optional(),
  type: z.string().max(32).nullable().optional(),
  labels: z.array(z.string().min(1).max(64)).max(32).optional(),
  assignee: z.string().max(64).nullable().optional(),
  agent: z.string().max(64).nullable().optional(),
  parentId: LocalId.nullable().optional(),
  repositoryId: LocalId.nullable().optional(),
  environment: z.string().max(255).nullable().optional().describe('COMPOSE_PROJECT_NAME the task is scoped to'),
  service: z.string().max(64).nullable().optional(),
  dueAt: z.number().int().nullable().optional().describe('Unix timestamp in seconds'),
  draft: z.boolean().optional(),
}).strict().meta({ ref: 'CreateTaskBody' })

const PatchTaskBody = CreateTaskBody.partial().extend({ title: z.string().min(1).max(200).optional() }).strict().meta({ ref: 'PatchTaskBody' })

const StartBody = z.object({ assign: z.boolean().optional() }).strict().meta({ ref: 'StartTaskBody' })
const StatusBody = z.object({ status: z.enum(TASK_STATUSES) }).strict().meta({ ref: 'TaskStatusBody' })
const MoveBody = z.object({
  status: z.enum(TASK_STATUSES),
  beforeId: LocalId.nullable().optional(),
  afterId: LocalId.nullable().optional(),
}).strict().refine((body) => body.beforeId !== body.afterId || body.beforeId == null, { message: 'beforeId and afterId must differ' }).meta({ ref: 'MoveTaskBody' })
const FinishBody = z.object({ close: z.boolean().optional() }).strict().meta({ ref: 'FinishTaskBody' })
const NoteBody = z.object({ body: z.string().min(1).max(65536) }).strict().meta({ ref: 'TaskNoteBody' })
const EnvironmentsBody = z.object({ environments: z.array(z.string().min(1).max(255)).max(32) }).strict().meta({ ref: 'TaskEnvironmentsBody' })
const Removal = z.object({ ok: z.boolean(), removed: z.string(), note: z.string() }).strict().meta({ ref: 'TaskRemoval' })

export const refParameter = {
  name: 'ref', in: 'path' as const, required: true,
  description: 'The task id, `#id`, or `owner/repo#number` through its GitHub binding.',
  schema: { type: 'string' as const },
}
const slugParameter = { name: 'slug', in: 'path' as const, required: true, description: 'The Project slug.', schema: { type: 'string' as const } }
export const actorHeader = {
  name: 'X-Portta-Actor', in: 'header' as const, required: false,
  description: 'Who asked. Recorded on the task, its notes and the activity; never forwarded to GitHub.',
  schema: { type: 'string' as const },
}
const FILTERS = [
  ['status', 'Comma-separated statuses.'], ['open', 'true for anything not done, false for done only.'],
  ['priority', 'Comma-separated priorities.'], ['type', 'Exact task type.'], ['label', 'One exact label.'],
  ['assignee', 'Exact assignee.'], ['agent', 'Exact agent.'], ['repository', 'Repository id.'],
  ['environment', 'COMPOSE_PROJECT_NAME.'], ['service', 'Exact service.'], ['parent', 'Parent task id, or "none" for top-level tasks.'],
  ['q', 'Substring of the title or description.'],
  ['limit', 'Maximum rows, from 1 to 2000.'],
  ['draft', 'true to list only drafts; omitted lists published tasks.'],
] as const
const filterParameters = FILTERS.map(([name, description]) => ({ name, in: 'query' as const, required: false, description, schema: { type: 'string' as const } }))

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function schedulable(rows: readonly TaskRow[]): SchedulableTask[] {
  return rows.map((row) => ({ id: row.id, parentId: row.parentId, status: row.status, priority: row.priority, assignee: row.assignee, waitingSince: seconds(row.updatedAt) }))
}

export function taskRoutes(deps: AppDeps): Hono {
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


  /**
   * A task, and whether this caller reaches the Project it is in.
   *
   * Wrapping the resolver rather than calling it and checking afterwards: a
   * task that came back before the check is a task somebody has already read.
   */
  async function requireTask(c: Context, db: Database, ref: string): Promise<TaskRow> {
    const task = await resolveTask(db, ref)
    authorizeScope(c, projectScope(task.projectId))
    return task
  }

  async function context(db: Database, tasks?: TaskRow[]): Promise<TaskContext> {
    return loadTaskContext(deps.config, db, await deps.cache.get(), tasks)
  }

  async function present(db: Database, task: TaskRow): Promise<Task> {
    const fresh = (await db.tasks.find(task.id)) ?? task
    const ctx = await context(db)
    const [notes, sessions, attachments] = await Promise.all([
      db.tasks.listNotes(fresh.id),
      db.sessions.list({ taskId: fresh.id, status: ['active'] }),
      db.tasks.listAttachments(fresh.id),
    ])
    return taskView(ctx, fresh, notes, sessions, attachments)
  }

  function announce(task: TaskRow, action: string, slug: string | null): void {
    deps.hub.publish({ kind: 'task', action, id: task.id, name: task.title, project: slug, ownership: null, at: Math.floor(Date.now() / 1000) })
  }

  async function slugOf(db: Database, task: TaskRow): Promise<string> {
    return (await db.projects.list()).find((project) => project.id === task.projectId)?.slug ?? task.projectId
  }

  async function environmentIdOf(db: Database, name: string | null | undefined): Promise<string | null | undefined> {
    if (name === undefined) return undefined
    if (name === null) return null
    const record = await db.environments.find(name)
    if (!record) throw new OverrideRefused(`no environment '${name}' is known to this panel`)
    return record.id
  }

  function dueAtOf(value: number | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined
    if (value === null) return null
    return new Date(value * 1000)
  }

  function shown(value: unknown): string {
    if (value == null || value === '') return 'none'
    if (Array.isArray(value)) return value.length === 0 ? 'none' : value.join(', ')
    return String(value)
  }

  function patchSummary(
    kind: 'task.created' | 'task.updated' | 'task.status' | 'task.assigned',
    actor: string | null,
    title: string,
    rest: Record<string, unknown>,
    changes: Record<string, { from: unknown; to: unknown }>,
  ): string {
    if (kind === 'task.created') return `${actor ?? 'somebody'} created "${typeof rest['title'] === 'string' ? rest['title'] : title}"`
    if (kind === 'task.status') return `"${title}" moved to ${String(rest['status'])}`
    if (kind === 'task.assigned') return `"${title}" assigned to ${rest['assignee'] ?? 'nobody'}`
    const keys = Object.keys(changes)
    if (keys.length === 1) {
      const key = keys[0]!
      const change = changes[key]!
      if (key === 'title') return `"${shown(change.from)}" renamed to "${shown(change.to)}"`
      if (key === 'description') return `"${title}" description updated`
      const labels: Record<string, string> = {
        priority: 'priority', type: 'type', labels: 'labels', agent: 'agent', dueAt: 'due date',
        parentId: 'parent', repositoryId: 'repository', environmentId: 'environment', service: 'service',
      }
      if (labels[key]) return `"${title}" ${labels[key]} changed from ${shown(change.from)} to ${shown(change.to)}`
    }
    return `"${title}" was edited`
  }

  async function wouldCycle(db: Database, taskId: string, parentId: string): Promise<boolean> {
    let current: string | null = parentId
    const seen = new Set<string>([taskId])
    while (current) {
      if (seen.has(current)) return true
      seen.add(current)
      const parent = await db.tasks.find(current)
      current = parent?.parentId ?? null
    }
    return false
  }

  /**
   * One local write, then GitHub when the task is bound. The activity line and
   * the live event carry the actor, so "did a person do that or an agent" has
   * an answer without inventing an identity system.
   */
  async function write(db: Database, task: TaskRow, patch: Record<string, unknown>, change: TaskChange, principal: Principal, kind: 'task.created' | 'task.updated' | 'task.status' | 'task.assigned', summary: string, activityData?: Record<string, unknown>): Promise<Task> {
    let updated: TaskRow | null
    if (patch['status'] !== undefined && patch['status'] !== task.status && patch['position'] === undefined) {
      const { status, ...rest } = patch
      const moved = await db.tasks.move(task.id, status as TaskRow['status'], null, null)
      updated = moved && Object.keys(rest).length > 0 ? await db.tasks.update(task.id, rest) : moved
    } else {
      updated = await db.tasks.update(task.id, patch)
    }
    if (!updated) throw new HTTPException(404, { message: `no task '${task.id}'` })
    const link = await db.tasks.findLink(task.id)
    const pushed = await pushToGitHub(db, deps.github, updated, link, change)
    const slug = await slugOf(db, updated)
    await recordActivity({ db, hub: deps.hub }, {
      kind, actor: principal.actor, actorKind: principal.actorKind, source: principal.source, project: slug,
      projectId: updated.projectId, taskId: updated.id, repositoryId: updated.repositoryId, environmentId: updated.environmentId,
      summary, data: { github: pushed, ...(activityData ?? change) },
    })
    announce(updated, kind.split('.')[1] ?? 'updated', slug)
    return present(db, updated)
  }

  // --- reads ----------------------------------------------------------------

  app.get('/projects/:slug/tasks', documentRoute({
    tag: 'Tasks', operationId: 'listProjectTasks', permission: 'task:read',
    summary: "List a Project's tasks",
    description: 'Local tasks, with their GitHub binding where one exists. Answers without GitHub and without the App.',
    response: TasksResponse, parameters: [slugParameter, ...filterParameters], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await requireProject(c, db, c.req.param('slug'))
    const query = new URL(c.req.url).searchParams
    const status = query.get('status')?.split(',').filter((value): value is typeof TASK_STATUSES[number] => (TASK_STATUSES as readonly string[]).includes(value))
    const parent = query.get('parent')
    const rows = await db.tasks.list({
      projectId: project.id,
      ...(status && status.length > 0 ? { status } : {}),
      ...(query.get('open') === 'true' ? { open: true } : query.get('open') === 'false' ? { open: false } : {}),
      ...(query.get('assignee') ? { assignee: query.get('assignee')! } : {}),
      ...(query.get('agent') ? { agent: query.get('agent')! } : {}),
      ...(query.get('priority') ? { priority: query.get('priority')!.split(',').filter((value): value is typeof TASK_PRIORITIES[number] => (TASK_PRIORITIES as readonly string[]).includes(value)) } : {}),
      ...(query.get('type') ? { type: query.get('type')! } : {}),
      ...(query.get('label') ? { label: query.get('label')! } : {}),
      ...(query.get('service') ? { service: query.get('service')! } : {}),
      ...(query.get('repository') ? { repositoryId: query.get('repository')! } : {}),
      ...(query.get('environment') ? { environmentId: (await db.environments.find(query.get('environment')!))?.id ?? '0' } : {}),
      ...(parent === 'none' ? { parentId: null } : parent ? { parentId: parent } : {}),
      ...(query.get('q') ? { q: query.get('q')! } : {}),
      ...(query.get('limit') && /^\d+$/.test(query.get('limit')!) ? { limit: Number(query.get('limit')) } : {}),
      draft: query.get('draft') === 'true' ? true : query.get('draft') === 'false' ? false : false,
    })
    const ctx = await context(db)
    return c.json({ tasks: taskSummaries(ctx, rows) })
  })

  app.get('/projects/:slug/tasks/next', documentRoute({
    tag: 'Tasks', operationId: 'nextTask', permission: 'task:read',
    summary: 'The task to do next, or null',
    description: 'Ready, unblocked by its subtasks, unassigned or assigned to the caller; then by priority, then by how long it has waited.',
    response: NextTaskResponse, parameters: [slugParameter, actorHeader], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await requireProject(c, db, c.req.param('slug'))
    const rows = await db.tasks.list({ projectId: project.id, open: true, draft: false })
    const chosen = nextTask(schedulable(rows), { actor: principalOf(c).actor })
    const row = chosen ? rows.find((task) => task.id === chosen.id) ?? null : null
    return c.json({ task: row ? await present(db, row) : null })
  })

  app.get('/tasks', documentRoute({
    tag: 'Tasks', operationId: 'listTasks', permission: 'task:read', summary: 'List tasks across Projects',
    description: 'The canonical remote listing. Use project to scope by slug; every result remains a local Portta task.',
    response: TasksResponse,
    parameters: [{ name: 'project', in: 'query', required: false, description: 'Project slug.', schema: { type: 'string' } }, ...filterParameters],
    errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const query = new URL(c.req.url).searchParams
    const projectSlug = query.get('project')
    const project = projectSlug ? await requireProject(c, db, projectSlug) : null
    const status = query.get('status')?.split(',').filter((value): value is typeof TASK_STATUSES[number] => (TASK_STATUSES as readonly string[]).includes(value))
    const priority = query.get('priority')?.split(',').filter((value): value is typeof TASK_PRIORITIES[number] => (TASK_PRIORITIES as readonly string[]).includes(value))
    const parent = query.get('parent')
    const environment = query.get('environment')
    const rows = await db.tasks.list({
      ...(project ? { projectId: project.id } : {}), ...(status?.length ? { status } : {}), ...(priority?.length ? { priority } : {}),
      ...(query.get('open') === 'true' ? { open: true } : query.get('open') === 'false' ? { open: false } : {}),
      ...(query.get('type') ? { type: query.get('type')! } : {}), ...(query.get('label') ? { label: query.get('label')! } : {}),
      ...(query.get('assignee') ? { assignee: query.get('assignee')! } : {}), ...(query.get('agent') ? { agent: query.get('agent')! } : {}),
      ...(query.get('repository') ? { repositoryId: query.get('repository')! } : {}),
      ...(environment ? { environmentId: (await db.environments.find(environment))?.id ?? '0' } : {}),
      ...(query.get('service') ? { service: query.get('service')! } : {}),
      ...(parent === 'none' ? { parentId: null } : parent ? { parentId: parent } : {}),
      ...(query.get('q') ? { q: query.get('q')! } : {}),
      ...(query.get('limit') && /^\d+$/.test(query.get('limit')!) ? { limit: Number(query.get('limit')) } : {}), draft: false,
    })
    // Across Projects means across the visible ones. Naming a Project was
    // already checked above; this is the unfiltered case.
    const reachable = visible(principalOf(c), rows, (row) => projectScope(row.projectId))
    return c.json({ tasks: taskSummaries(await context(db, reachable), reachable) })
  })

  app.get('/tasks/:ref', documentRoute({
    tag: 'Tasks', operationId: 'getTask', permission: 'task:read', summary: 'Get one task',
    description: 'With its binding, environments, notes and subtasks. Addressable by id, `#id`, or `owner/repo#number`.',
    response: Task, parameters: [refParameter], errors: [400, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    return c.json(await present(db, await requireTask(c, db, c.req.param('ref'))))
  })

  app.get('/tasks/:ref/subtasks', documentRoute({
    tag: 'Tasks', operationId: 'getSubtasks', permission: 'task:read', summary: 'The subtask tree under one task',
    response: SubtasksResponse, parameters: [refParameter], errors: [400, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const rows = await db.tasks.list({ projectId: task.projectId })
    const ctx = await context(db, rows)
    const tree = subtaskTree(task.id, rows)
    const render = (nodes: typeof tree): unknown[] => nodes.map((node) => ({ task: taskSummary(ctx, node.task), children: render(node.children) }))
    return c.json({ subtasks: render(tree) })
  })

  app.post('/tasks/:ref/subtasks', documentRoute({
    tag: 'Tasks', operationId: 'createTaskSubtask', permission: 'task:write', summary: 'Create a subtask',
    request: CreateTaskBody.omit({ parentId: true, draft: true }), response: Task, status: 201,
    parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const parent = await requireTask(c, db, c.req.param('ref'))
    const body = CreateTaskBody.omit({ parentId: true, draft: true }).parse(await c.req.json())
    const principal = principalOf(c)
    const { environment, dueAt, ...rest } = body
    const environmentId = await environmentIdOf(db, environment)
    const child = await db.tasks.create(parent.projectId, {
      ...rest, parentId: parent.id,
      ...(environmentId !== undefined ? { environmentId } : {}),
      ...(dueAt !== undefined ? { dueAt: dueAtOf(dueAt) } : {}),
    }, principal.actor)
    const slug = await slugOf(db, parent)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.updated', actor: principal.actor, actorKind: principal.actorKind, source: principal.source,
      project: slug, projectId: parent.projectId, taskId: parent.id,
      summary: `Subtask #${child.id} added to "${parent.title}"`, data: { subtaskId: child.id, action: 'created' },
    })
    announce(child, 'created', slug)
    return c.json(await present(db, child), 201)
  })

  app.put('/tasks/:ref/subtasks/:childRef', documentRoute({
    tag: 'Tasks', operationId: 'linkTaskSubtask', permission: 'task:write', summary: 'Link an existing task as a subtask',
    response: Task, parameters: [refParameter, { name: 'childRef', in: 'path', required: true, schema: { type: 'string' } }, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const parent = await requireTask(c, db, c.req.param('ref'))
    const child = await requireTask(c, db, c.req.param('childRef'))
    if (parent.projectId !== child.projectId) throw new OverrideRefused('a subtask belongs to the same Project as its parent')
    if (parent.id === child.id || await wouldCycle(db, child.id, parent.id)) throw new OverrideRefused('a task cannot become a descendant of itself')
    const updated = await db.tasks.update(child.id, { parentId: parent.id })
    if (!updated) throw new HTTPException(404, { message: `no task '${child.id}'` })
    const principal = principalOf(c)
    const slug = await slugOf(db, parent)
    await recordActivity({ db, hub: deps.hub }, { kind: 'task.updated', actor: principal.actor, actorKind: principal.actorKind, source: principal.source, project: slug, projectId: parent.projectId, taskId: parent.id, summary: `Task #${child.id} linked as a subtask`, data: { subtaskId: child.id, action: 'linked' } })
    return c.json(await present(db, updated))
  })

  app.delete('/tasks/:ref/subtasks/:childRef', documentRoute({
    tag: 'Tasks', operationId: 'unlinkTaskSubtask', permission: 'task:write', summary: 'Unlink a subtask',
    response: Task, parameters: [refParameter, { name: 'childRef', in: 'path', required: true, schema: { type: 'string' } }, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const parent = await requireTask(c, db, c.req.param('ref'))
    const child = await requireTask(c, db, c.req.param('childRef'))
    if (child.parentId !== parent.id) throw new OverrideRefused(`task '${child.id}' is not a subtask of '${parent.id}'`)
    const updated = await db.tasks.update(child.id, { parentId: null })
    if (!updated) throw new HTTPException(404, { message: `no task '${child.id}'` })
    const principal = principalOf(c)
    const slug = await slugOf(db, parent)
    await recordActivity({ db, hub: deps.hub }, { kind: 'task.updated', actor: principal.actor, actorKind: principal.actorKind, source: principal.source, project: slug, projectId: parent.projectId, taskId: parent.id, summary: `Task #${child.id} unlinked from subtasks`, data: { subtaskId: child.id, action: 'unlinked' } })
    return c.json(await present(db, updated))
  })

  app.get('/tasks/:ref/notes', documentRoute({
    tag: 'Tasks', operationId: 'listTaskNotes', permission: 'task:read', summary: 'The notes on a task, oldest first',
    response: NotesResponse, parameters: [refParameter], errors: [400, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    return c.json({ notes: (await db.tasks.listNotes(task.id)).map(noteView) })
  })

  app.get('/tasks/:ref/comments', documentRoute({
    tag: 'Tasks', operationId: 'listTaskComments', permission: 'task:read', summary: 'The local comments on a task, oldest first',
    response: CommentsResponse, parameters: [refParameter], errors: [400, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    return c.json({ comments: (await db.tasks.listNotes(task.id)).map(noteView) })
  })

  const attachmentParameter = { name: 'attachmentId', in: 'path' as const, required: true, schema: { type: 'string' as const } }

  app.get('/tasks/:ref/attachments', documentRoute({
    tag: 'Tasks', operationId: 'listTaskAttachments', permission: 'task:read',
    summary: 'The files attached to a task, newest first',
    description: 'Metadata only. The bytes are at the downloadUrl each entry carries.',
    response: AttachmentsResponse, parameters: [refParameter], errors: [400, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const rows = await db.tasks.listAttachments(task.id)
    return c.json({ attachments: rows.map((row) => attachmentView(task.id, row)) })
  })

  app.get('/tasks/:ref/attachments/:attachmentId', documentRoute({
    tag: 'Tasks', operationId: 'downloadTaskAttachment', permission: 'task:read',
    summary: 'The bytes of one attachment',
    description: 'Served with a Content-Disposition that renders an image or a PDF inline and downloads everything else.',
    response: z.string().meta({ ref: 'TaskAttachmentBytes' }), mediaType: 'application/octet-stream',
    parameters: [refParameter, attachmentParameter], errors: [400, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const found = await db.tasks.readAttachment(task.id, c.req.param('attachmentId'))
    if (!found) throw new HTTPException(404, { message: 'no such attachment' })
    // Uploaded bytes are served from the panel's own origin, so the browser is
    // told exactly what they are and never allowed to sniff something else out
    // of them.
    // A Buffer is a view into a shared pool, so the exact bytes of this row
    // are sliced out before they leave the process.
    const body = found.content.buffer.slice(
      found.content.byteOffset,
      found.content.byteOffset + found.content.byteLength,
    ) as ArrayBuffer
    return c.body(body, 200, {
      'Content-Type': found.row.contentType,
      'Content-Length': String(found.content.byteLength),
      'Content-Disposition': contentDisposition(found.row.filename, found.row.contentType),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=300',
    })
  })

  // --- writes ---------------------------------------------------------------

  app.post('/projects/:slug/tasks', documentRoute({
    tag: 'Tasks', operationId: 'createTask', permission: 'task:write', summary: 'Create a task',
    description: 'Local, immediately. Bind it to a GitHub issue afterwards with /github/link or /github/publish.',
    request: CreateTaskBody, response: Task, status: 201, parameters: [slugParameter, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await requireProject(c, db, c.req.param('slug'))
    const body = CreateTaskBody.parse(await c.req.json())
    const principal = principalOf(c)
    const { environment, dueAt, ...rest } = body
    if (rest.parentId) {
      const parent = await db.tasks.find(rest.parentId)
      if (!parent || parent.projectId !== project.id) throw new OverrideRefused('a subtask belongs to the same Project as its parent')
    }
    if (rest.repositoryId) {
      const repository = await db.repositories.find(rest.repositoryId)
      if (!repository || repository.projectId !== project.id) throw new OverrideRefused('that repository does not belong to this Project')
    }
    const environmentId = await environmentIdOf(db, environment)
    if (rest.draft) {
      await db.tasks.sweepIntactDrafts(project.id, new Date(Date.now() - TASK_DRAFT_MAX_AGE_MS))
      const reused = await db.tasks.findIntactDraft({ projectId: project.id, createdBy: principal.actor, parentId: rest.parentId ?? null })
      if (reused) return c.json(await present(db, reused), 200)
    }
    const created = await db.tasks.create(project.id, {
      ...rest,
      title: rest.title || TASK_DRAFT_TITLE,
      ...(environmentId !== undefined ? { environmentId } : {}),
      ...(dueAt !== undefined ? { dueAt: dueAtOf(dueAt) } : {}),
    }, principal.actor)
    if (!created.draft) {
      await recordActivity({ db, hub: deps.hub }, {
        kind: 'task.created', actor: principal.actor, actorKind: principal.actorKind, source: principal.source, project: project.slug,
        projectId: project.id, taskId: created.id, repositoryId: created.repositoryId, environmentId: created.environmentId,
        summary: `${principal.actor ?? 'somebody'} created "${created.title}"`,
      })
      announce(created, 'created', project.slug)
    }
    return c.json(await present(db, created), 201)
  })

  app.patch('/tasks/:ref', documentRoute({
    tag: 'Tasks', operationId: 'patchTask', permission: 'task:write', summary: 'Change a task',
    description: 'Written locally first. On a bound task, title, description, status, priority and assignee are also written to GitHub; the binding says whether that reached it.',
    request: PatchTaskBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const body = PatchTaskBody.parse(await c.req.json())
    if (Object.keys(body).length === 0) throw new OverrideRefused('nothing to change')
    const { environment, dueAt, ...rest } = body
    if (rest.parentId) {
      if (rest.parentId === task.id) throw new OverrideRefused('a task cannot be its own parent')
      const parent = await db.tasks.find(rest.parentId)
      if (!parent || parent.projectId !== task.projectId) throw new OverrideRefused('a subtask belongs to the same Project as its parent')
      if (await wouldCycle(db, task.id, rest.parentId)) throw new OverrideRefused('a task cannot become a descendant of itself')
    }
    if (rest.repositoryId) {
      const repository = await db.repositories.find(rest.repositoryId)
      if (!repository || repository.projectId !== task.projectId) throw new OverrideRefused('that repository does not belong to this Project')
    }
    const environmentId = await environmentIdOf(db, environment)
    const patch: Record<string, unknown> = { ...rest, ...(environmentId !== undefined ? { environmentId } : {}), ...(dueAt !== undefined ? { dueAt: dueAtOf(dueAt) } : {}) }
    if (task.draft && shouldPromoteDraft({
      draft: task.draft, title: task.title, description: task.description, status: task.status,
      priority: task.priority, type: task.type, labels: task.labels, assignee: task.assignee,
      agent: task.agent, service: task.service, dueAt: task.dueAt,
    }, {
      ...(rest.title !== undefined ? { title: rest.title } : {}),
      ...(rest.description !== undefined ? { description: rest.description } : {}),
      ...(rest.status !== undefined ? { status: rest.status } : {}),
      ...(rest.priority !== undefined ? { priority: rest.priority } : {}),
      ...(rest.type !== undefined ? { type: rest.type } : {}),
      ...(rest.labels !== undefined ? { labels: rest.labels } : {}),
      ...(rest.assignee !== undefined ? { assignee: rest.assignee } : {}),
      ...(rest.agent !== undefined ? { agent: rest.agent } : {}),
      ...(rest.service !== undefined ? { service: rest.service } : {}),
      ...(dueAt !== undefined ? { dueAt: dueAtOf(dueAt) } : {}),
      ...(rest.draft !== undefined ? { draft: rest.draft } : {}),
    })) {
      patch.draft = false
    }
    const change: TaskChange = {
      ...(rest.title !== undefined ? { title: rest.title } : {}),
      ...(rest.description !== undefined ? { description: rest.description } : {}),
      ...(rest.status !== undefined ? { status: rest.status } : {}),
      ...(rest.priority !== undefined ? { priority: rest.priority } : {}),
      ...(rest.assignee !== undefined ? { assignee: rest.assignee } : {}),
      ...(rest.labels !== undefined ? { labels: rest.labels } : {}),
      ...(rest.status === 'done' ? { close: true } : {}),
    }
    const principal = principalOf(c)
    const kind = patch.draft === false && task.draft
      ? 'task.created'
      : rest.status !== undefined && rest.status !== task.status ? 'task.status' : rest.assignee !== undefined ? 'task.assigned' : 'task.updated'
    const previous: Record<string, unknown> = {
      title: task.title, description: task.description, status: task.status, priority: task.priority, type: task.type,
      labels: task.labels, assignee: task.assignee, agent: task.agent, parentId: task.parentId,
      repositoryId: task.repositoryId, environmentId: task.environmentId, service: task.service, dueAt: task.dueAt?.toISOString() ?? null,
    }
    const changes = Object.fromEntries(Object.entries(patch)
      .filter(([key, next]) => key !== 'draft' && key !== 'position' && JSON.stringify(previous[key] ?? null) !== JSON.stringify(next instanceof Date ? next.toISOString() : next ?? null))
      .map(([key, next]) => [key, { from: previous[key] ?? null, to: next instanceof Date ? next.toISOString() : next ?? null }]))
    return c.json(await write(db, task, patch, change, principal, kind, patchSummary(kind, principal.actor, task.title, rest, changes), { changes }))
  })

  app.delete('/tasks/:ref', documentRoute({
    tag: 'Tasks', operationId: 'deleteTask', permission: 'task:delete', summary: 'Delete a task and its subtasks',
    description: 'Local only: a bound GitHub issue is left as it is, unbound.',
    response: Removal, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const slug = await slugOf(db, task)
    const principal = principalOf(c)
    await db.tasks.remove(task.id)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.deleted', actor: principal.actor, actorKind: principal.actorKind, source: principal.source, project: slug,
      projectId: task.projectId, repositoryId: task.repositoryId, summary: `"${task.title}" was deleted`, data: { taskId: task.id },
    })
    announce(task, 'deleted', slug)
    return c.json({ ok: true, removed: task.id, note: 'the task and its subtasks; a bound GitHub issue is untouched' })
  })

  app.post('/tasks/:ref/start', documentRoute({
    tag: 'Tasks', operationId: 'startTask', permission: 'task:write', summary: 'Take a task',
    description: 'Sets the status to in_progress and, unless assign is false, assigns the actor — in one write, so a task is never half-taken.',
    request: StartBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const body = StartBody.parse(await c.req.json().catch(() => ({})))
    const principal = principalOf(c)
    const plan = startPlan(task, body.assign === false ? null : principal.actor)
    const patch: Record<string, unknown> = { status: plan.status, ...(plan.assignee ? { assignee: plan.assignee } : {}), ...(principal.actorKind === 'agent' && plan.assignee ? { agent: principal.actor } : {}), ...(task.draft ? { draft: false } : {}) }
    return c.json(await write(db, task, patch, { status: plan.status, ...(plan.assignee ? { assignee: plan.assignee } : {}) }, principal, 'task.status', `${principal.actor ?? 'somebody'} started "${task.title}"`))
  })

  app.post('/tasks/:ref/status', documentRoute({
    tag: 'Tasks', operationId: 'setTaskStatus', permission: 'task:write', summary: 'Move a task to one status',
    request: StatusBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const body = StatusBody.parse(await c.req.json())
    const principal = principalOf(c)
    return c.json(await write(db, task, { status: body.status, ...(task.draft ? { draft: false } : {}) }, { status: body.status, ...(body.status === 'done' ? { close: true } : {}) }, principal, 'task.status', `"${task.title}" moved to ${body.status}`))
  })

  app.post('/tasks/:ref/move', documentRoute({
    tag: 'Tasks', operationId: 'moveTask', permission: 'task:write', summary: 'Move and rank a task on the board',
    description: 'Changes status and/or order atomically. beforeId and afterId name the adjacent tasks after the move; no neighbours appends.',
    request: MoveBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const body = MoveBody.parse(await c.req.json())
    const previousPosition = task.position
    const previousStatus = task.status
    const neighbours = new Map<string, TaskRow>()
    for (const neighbourId of [body.beforeId, body.afterId]) {
      if (!neighbourId) continue
      const neighbour = await db.tasks.find(neighbourId)
      if (!neighbour || neighbour.projectId !== task.projectId || neighbour.status !== body.status || neighbour.id === task.id) {
        throw new OverrideRefused(`invalid move neighbour '${neighbourId}'`)
      }
      neighbours.set(neighbourId, neighbour)
    }
    const before = body.beforeId ? neighbours.get(body.beforeId) : null
    const after = body.afterId ? neighbours.get(body.afterId) : null
    if (before && after && before.position >= after.position) throw new OverrideRefused('beforeId must precede afterId in the destination column')
    const moved = await db.tasks.move(task.id, body.status, body.beforeId ?? null, body.afterId ?? null)
    if (!moved) throw new HTTPException(404, { message: `no task '${task.id}'` })
    const principal = principalOf(c)
    const link = await db.tasks.findLink(task.id)
    const pushed = await pushToGitHub(db, deps.github, moved, link, previousStatus === body.status ? {} : { status: body.status, ...(body.status === 'done' ? { close: true } : {}) })
    const slug = await slugOf(db, moved)
    await recordActivity({ db, hub: deps.hub }, {
      kind: previousStatus === body.status ? 'task.updated' : 'task.status', actor: principal.actor, actorKind: principal.actorKind,
      source: principal.source, project: slug, projectId: moved.projectId, taskId: moved.id, repositoryId: moved.repositoryId,
      summary: previousStatus === body.status ? `"${task.title}" reordered` : `"${task.title}" moved to ${body.status}`,
      data: { github: pushed, position: { from: previousPosition, to: moved.position }, status: { from: previousStatus, to: moved.status } },
    })
    announce(moved, 'moved', slug)
    return c.json(await present(db, moved))
  })

  app.post('/tasks/:ref/finish', documentRoute({
    tag: 'Tasks', operationId: 'finishTask', permission: 'task:write', summary: 'Finish a task',
    description: 'Sets the status to done. On a bound task, close: true also closes the issue on GitHub.',
    request: FinishBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const body = FinishBody.parse(await c.req.json().catch(() => ({})))
    const plan = finishPlan(body.close === true)
    const principal = principalOf(c)
    return c.json(await write(db, task, { status: plan.status, ...(task.draft ? { draft: false } : {}) }, { status: plan.status, close: plan.close }, principal, 'task.status', `${principal.actor ?? 'somebody'} finished "${task.title}"`))
  })

  app.post('/tasks/:ref/notes', documentRoute({
    tag: 'Tasks', operationId: 'addTaskNote', permission: 'task:write', summary: 'Add a note to a task',
    description: 'Legacy alias for a local comment. Prefer /comments.',
    request: NoteBody, response: TaskNote, status: 201, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const body = NoteBody.parse(await c.req.json())
    const principal = principalOf(c)
    const note = await db.tasks.addNote(task.id, body.body, principal.actor, principal.actorKind)
    if (task.draft) await db.tasks.update(task.id, { draft: false })
    const slug = await slugOf(db, task)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.note', actor: principal.actor, actorKind: principal.actorKind, source: principal.source, project: slug,
      projectId: task.projectId, taskId: task.id, repositoryId: task.repositoryId,
      summary: `${principal.actor ?? 'somebody'} noted on "${task.title}"`, data: { noteId: note.id },
    })
    announce(task, 'note', slug)
    return c.json(noteView(note), 201)
  })

  app.post('/tasks/:ref/comments', documentRoute({
    tag: 'Tasks', operationId: 'addTaskComment', permission: 'task:write', summary: 'Add a local comment to a task',
    description: 'Always local. Publishing this comment to GitHub is a separate, explicit operation.',
    request: NoteBody, response: TaskNote, status: 201, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const body = NoteBody.parse(await c.req.json())
    const principal = principalOf(c)
    const note = await db.tasks.addNote(task.id, body.body, principal.actor, principal.actorKind)
    if (task.draft) await db.tasks.update(task.id, { draft: false })
    const slug = await slugOf(db, task)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.comment', actor: principal.actor, actorKind: principal.actorKind, source: principal.source,
      project: slug, projectId: task.projectId, taskId: task.id, repositoryId: task.repositoryId,
      summary: `${principal.actor ?? 'somebody'} commented on "${task.title}"`, data: { commentId: note.id },
    })
    announce(task, 'comment', slug)
    return c.json(noteView(note), 201)
  })

  app.post('/tasks/:ref/attachments', documentRoute({
    tag: 'Tasks', operationId: 'addTaskAttachment', permission: 'task:write',
    summary: 'Attach a file to a task',
    description: `Multipart, one file in the \`file\` field. At most ${ATTACHMENT_LIMITS.maxBytes / 1024 / 1024} MB per file and ${ATTACHMENT_LIMITS.maxPerTask} files per task.`,
    requestMediaType: 'multipart/form-data',
    requestSchemaOverride: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        filename: { type: 'string', description: 'Overrides the name the part carries' },
      },
    },
    response: TaskAttachment, status: 201, parameters: [refParameter, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const form = await c.req.parseBody()
    const file = form['file']
    if (!(file instanceof File)) throw new OverrideRefused('send the file in a multipart field named file')

    const existing = await db.tasks.listAttachments(task.id)
    const bytes = Buffer.from(await file.arrayBuffer())
    const rejection = rejectUpload({ sizeBytes: bytes.byteLength, existingCount: existing.length })
    if (rejection) throw new OverrideRefused(`that file was not stored: ${rejection.detail}`)

    const declaredName = typeof form['filename'] === 'string' ? form['filename'] : file.name
    const filename = safeFilename(declaredName)
    const contentType = normaliseContentType(file.type, filename)
    const principal = principalOf(c)
    const stored = await db.tasks.addAttachment(task.id, { filename, contentType, content: bytes }, principal.actor, principal.actorKind)
    if (task.draft) await db.tasks.update(task.id, { draft: false })
    const slug = await slugOf(db, task)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.updated', actor: principal.actor, actorKind: principal.actorKind, source: principal.source,
      project: slug, projectId: task.projectId, taskId: task.id, repositoryId: task.repositoryId,
      summary: `${principal.actor ?? 'somebody'} attached ${filename} to "${task.title}"`,
      data: { attachmentId: stored.id, filename },
    })
    announce(task, 'attachment', slug)
    return c.json(attachmentView(task.id, stored), 201)
  })

  app.delete('/tasks/:ref/attachments/:attachmentId', documentRoute({
    tag: 'Tasks', operationId: 'deleteTaskAttachment', permission: 'task:write',
    summary: 'Remove an attachment',
    description: 'The bytes go with it. Nothing outside this task is touched.',
    response: OkResponse, parameters: [refParameter, attachmentParameter, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const attachmentId = c.req.param('attachmentId')
    const found = await db.tasks.findAttachment(task.id, attachmentId)
    if (!found) throw new HTTPException(404, { message: 'no such attachment' })
    await db.tasks.removeAttachment(task.id, attachmentId)
    const principal = principalOf(c)
    const slug = await slugOf(db, task)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.updated', actor: principal.actor, actorKind: principal.actorKind, source: principal.source,
      project: slug, projectId: task.projectId, taskId: task.id, repositoryId: task.repositoryId,
      summary: `${principal.actor ?? 'somebody'} removed ${found.filename} from "${task.title}"`,
      data: { attachmentId, filename: found.filename },
    })
    announce(task, 'attachment', slug)
    return c.json({ ok: true })
  })

  app.patch('/tasks/:ref/notes/:noteId', documentRoute({
    tag: 'Tasks', operationId: 'updateTaskNote', permission: 'task:write', summary: 'Edit a local note',
    request: NoteBody, response: TaskNote, parameters: [refParameter, { name: 'noteId', in: 'path' as const, required: true, schema: { type: 'string' as const } }, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const existing = await db.tasks.findNote(task.id, c.req.param('noteId'))
    if (!existing) throw new HTTPException(404, { message: `no note '${c.req.param('noteId')}'` })
    const principal = principalOf(c)
    if (existing.actor && principal.actor && existing.actor !== principal.actor && principal.actorKind === 'agent') {
      throw new OverrideRefused('only the author can edit this note')
    }
    const body = NoteBody.parse(await c.req.json())
    const updated = await db.tasks.updateNote(task.id, existing.id, body.body)
    if (!updated) throw new HTTPException(404, { message: `no note '${existing.id}'` })
    return c.json(noteView(updated))
  })

  app.patch('/tasks/:ref/comments/:noteId', documentRoute({
    tag: 'Tasks', operationId: 'updateTaskComment', permission: 'task:write', summary: 'Edit a local comment',
    request: NoteBody, response: TaskNote, parameters: [refParameter, { name: 'noteId', in: 'path' as const, required: true, schema: { type: 'string' as const } }, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const existing = await db.tasks.findNote(task.id, c.req.param('noteId'))
    if (!existing) throw new HTTPException(404, { message: `no comment '${c.req.param('noteId')}'` })
    const principal = principalOf(c)
    if (existing.actor && principal.actor && existing.actor !== principal.actor && principal.actorKind === 'agent') throw new OverrideRefused('only the author can edit this comment')
    const updated = await db.tasks.updateNote(task.id, existing.id, NoteBody.parse(await c.req.json()).body)
    if (!updated) throw new HTTPException(404, { message: `no comment '${existing.id}'` })
    return c.json(noteView(updated))
  })

  app.delete('/tasks/:ref/notes/:noteId', documentRoute({
    tag: 'Tasks', operationId: 'deleteTaskNote', permission: 'task:write', summary: 'Delete a local note',
    response: z.object({ ok: z.boolean(), removed: z.string() }).strict(),
    parameters: [refParameter, { name: 'noteId', in: 'path' as const, required: true, schema: { type: 'string' as const } }, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const existing = await db.tasks.findNote(task.id, c.req.param('noteId'))
    if (!existing) throw new HTTPException(404, { message: `no note '${c.req.param('noteId')}'` })
    const principal = principalOf(c)
    if (existing.actor && principal.actor && existing.actor !== principal.actor && principal.actorKind === 'agent') {
      throw new OverrideRefused('only the author can delete this note')
    }
    await db.tasks.removeNote(task.id, existing.id)
    return c.json({ ok: true, removed: existing.id })
  })

  app.delete('/tasks/:ref/comments/:noteId', documentRoute({
    tag: 'Tasks', operationId: 'deleteTaskComment', permission: 'task:write', summary: 'Delete a local comment',
    response: z.object({ ok: z.boolean(), removed: z.string() }).strict(),
    parameters: [refParameter, { name: 'noteId', in: 'path' as const, required: true, schema: { type: 'string' as const } }, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const existing = await db.tasks.findNote(task.id, c.req.param('noteId'))
    if (!existing) throw new HTTPException(404, { message: `no comment '${c.req.param('noteId')}'` })
    const principal = principalOf(c)
    if (existing.actor && principal.actor && existing.actor !== principal.actor && principal.actorKind === 'agent') throw new OverrideRefused('only the author can delete this comment')
    await db.tasks.removeNote(task.id, existing.id)
    return c.json({ ok: true, removed: existing.id })
  })

  app.post('/projects/:slug/tasks/import', documentRoute({
    tag: 'Tasks', operationId: 'importProjectTasks', permission: 'task:write',
    summary: 'Import a versioned task document',
    description: 'Reconciles by source_key. Repository, environment and parent are names, never database ids.',
    request: ExampleDocument, response: z.object({ project: z.string(), created: z.number(), updated: z.number(), tasks: z.array(Task) }).strict(),
    parameters: [slugParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    await requireProject(c, db, c.req.param('slug'))
    const applied = await applyExampleDocument(db, deps.config, await deps.cache.get(), c.req.param('slug'), await c.req.json())
    return c.json(applied)
  })

  app.get('/projects/:slug/tasks/export', documentRoute({
    tag: 'Tasks', operationId: 'exportProjectTasks', permission: 'task:read',
    summary: 'Export the project tasks as a versioned document',
    response: ExampleDocument, parameters: [slugParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    await requireProject(c, db, c.req.param('slug'))
    return c.json(await exportProjectTasks(db, deps.config, await deps.cache.get(), c.req.param('slug')))
  })

  /**
   * Links a task to the environments it is being worked in, by hand. Writes
   * one row per link; nothing is started, stopped, created or removed, and a
   * manual link always wins over an inferred one.
   */
  app.put('/tasks/:ref/environments', documentRoute({
    tag: 'Tasks', operationId: 'setTaskEnvironments', permission: 'task:write',
    summary: 'Link a task to the environments it is worked in',
    request: EnvironmentsBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await requireTask(c, db, c.req.param('ref'))
    const body = EnvironmentsBody.parse(await c.req.json())
    const snapshot = await deps.cache.get()
    // An environment adopted by another Project is that Project's: linking a
    // task across that line would make "what is this running for" answer
    // with somebody else's work.
    const adopted = new Map((await db.projects.listEnvironments()).map((row) => [row.composeProject, row.projectId]))
    for (const name of body.environments) {
      if (!snapshot.environments.some((environment) => environment.name === name)) throw new OverrideRefused(`no environment '${name}' is running`)
      const owner = adopted.get(name)
      if (owner !== undefined && owner !== task.projectId) throw new OverrideRefused(`environment '${name}' belongs to another Project`)
    }
    await db.tasks.setEnvironments(task.id, body.environments)
    const principal = principalOf(c)
    const slug = await slugOf(db, task)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.linked', actor: principal.actor, actorKind: principal.actorKind, project: slug,
      projectId: task.projectId, taskId: task.id, summary: `"${task.title}" linked to ${body.environments.join(', ') || 'no environment'}`,
      data: { environments: body.environments },
    })
    announce(task, 'linked', slug)
    return c.json(await present(db, task))
  })

  return app
}
