// Apply and export a versioned example document. References are names.
//
// `key` becomes `source_key`. A second apply updates the same rows. The CLI
// never opens Postgres: it posts the document here.

import { ExampleDocument, flattenExampleTasks, type ExampleTask } from 'portta-core'
import { OverrideRefused } from './overrides.ts'
import type { Database } from '../db/index.ts'
import type { TaskRow } from '../db/tasks.ts'
import { loadTaskContext, taskView } from './task-view.ts'
import type { PanelConfig } from '../config.ts'
import type { Snapshot } from './inventory.ts'
import type { Task } from 'portta-contracts'

export interface ExampleApplyResult {
  project: string
  created: number
  updated: number
  tasks: Task[]
}

function parseDueAt(value: string | null | undefined): Date | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new OverrideRefused(`invalid dueAt '${value}'`)
  return date
}

export async function applyExampleDocument(
  db: Database,
  config: PanelConfig,
  snapshot: Snapshot,
  slug: string,
  raw: unknown,
): Promise<ExampleApplyResult> {
  const document = ExampleDocument.parse(raw)
  if (document.project.slug !== slug) {
    throw new OverrideRefused(`document project '${document.project.slug}' does not match '${slug}'`)
  }
  const project = await db.projects.find(slug)
  if (!project) throw new OverrideRefused(`no project '${slug}'`)

  const repositories = await db.repositories.list(project.id)
  const repositoryByKey = new Map(repositories.map((row) => [row.name, row]))
  for (const entry of document.repositories ?? []) {
    repositoryByKey.set(entry.key, repositoryByKey.get(entry.name) ?? repositoryByKey.get(entry.key) ?? (await db.repositories.create(project.id, {
      name: entry.name,
      role: entry.role ?? null,
      localPath: null,
      relativePath: null,
      remoteUrl: null,
      githubRepositoryId: null,
      position: 0,
    })))
  }

  const environments = await db.environments.list()
  const environmentByName = new Map(environments.map((row) => [row.composeProject, row]))
  for (const spec of flattenExampleTasks(document.tasks)) {
    if (spec.environment && !environmentByName.has(spec.environment)) {
      const seen = await db.environments.upsertSeen({ composeProject: spec.environment })
      environmentByName.set(spec.environment, seen)
    }
  }
  const flat = flattenExampleTasks(document.tasks)
  const byKey = new Map<string, string>()
  let created = 0
  let updated = 0

  for (const spec of flat) {
    const repository = spec.repository
      ? repositoryByKey.get(spec.repository) ?? repositories.find((row) => row.name === spec.repository)
      : undefined
    if (spec.repository && !repository) throw new OverrideRefused(`no repository '${spec.repository}' on project '${slug}'`)
    const environment = spec.environment ? environmentByName.get(spec.environment) : undefined
    if (spec.environment && !environment) throw new OverrideRefused(`no environment '${spec.environment}' is known to this panel`)
    const parentId = spec.parent ? byKey.get(spec.parent) ?? null : null
    if (spec.parent && !parentId) throw new OverrideRefused(`parent '${spec.parent}' must appear before '${spec.key}'`)

    const input = {
      title: spec.title,
      description: spec.description ?? null,
      status: spec.status ?? 'backlog',
      priority: spec.priority ?? null,
      type: spec.type ?? null,
      labels: spec.labels ?? [],
      assignee: spec.assignee ?? null,
      agent: spec.agent ?? null,
      parentId,
      repositoryId: repository?.id ?? null,
      environmentId: environment?.id ?? null,
      service: spec.service ?? null,
      dueAt: parseDueAt(spec.dueAt),
      sourceKey: spec.key,
      draft: false,
    }

    const existing = await db.tasks.findBySourceKey(project.id, spec.key)
    const row = existing
      ? await db.tasks.update(existing.id, input)
      : await db.tasks.create(project.id, input, 'example')
    if (!row) throw new OverrideRefused(`failed to persist task '${spec.key}'`)
    if (existing) updated += 1
    else created += 1
    byKey.set(spec.key, row.id)
    await reconcileComments(db, row, spec)
  }

  const ctx = await loadTaskContext(config, db, snapshot)
  const tasks: Task[] = []
  for (const spec of flat) {
    const id = byKey.get(spec.key)
    const row = id ? await db.tasks.find(id) : null
    if (!row) continue
    const notes = await db.tasks.listNotes(row.id)
    tasks.push(taskView(ctx, row, notes, []))
  }
  return { project: slug, created, updated, tasks }
}

async function reconcileComments(db: Database, task: TaskRow, spec: ExampleTask): Promise<void> {
  for (const comment of spec.comments ?? []) {
    const existing = await db.tasks.findNoteBySourceKey(task.id, comment.key)
    if (existing) {
      if (existing.body !== comment.body) await db.tasks.updateNote(task.id, existing.id, comment.body)
      continue
    }
    await db.tasks.addNote(task.id, comment.body, comment.actor, comment.actorKind ?? 'human', comment.key)
  }
}

export async function exportProjectTasks(
  db: Database,
  config: PanelConfig,
  snapshot: Snapshot,
  slug: string,
): Promise<ReturnType<typeof ExampleDocument.parse>> {
  const project = await db.projects.find(slug)
  if (!project) throw new OverrideRefused(`no project '${slug}'`)
  const [rows, repositories] = await Promise.all([
    db.tasks.list({ projectId: project.id, draft: false }),
    db.repositories.list(project.id),
  ])
  const ctx = await loadTaskContext(config, db, snapshot, rows)
  const keyOf = (row: TaskRow) => row.sourceKey ?? `task-${row.id}`
  const tasks: ExampleTask[] = []
  for (const row of rows.filter((entry) => !entry.parentId)) {
    tasks.push(await toExampleTask(db, ctx, row, rows, keyOf))
  }
  return {
    schemaVersion: 1,
    project: { slug: project.slug, name: project.name, description: project.description ?? null },
    repositories: repositories.map((row) => ({ key: row.name, name: row.name, role: row.role })),
    tasks,
  }
}

async function toExampleTask(
  db: Database,
  ctx: Awaited<ReturnType<typeof loadTaskContext>>,
  row: TaskRow,
  all: TaskRow[],
  keyOf: (row: TaskRow) => string,
): Promise<ExampleTask> {
  const notes = await db.tasks.listNotes(row.id)
  const children = all.filter((entry) => entry.parentId === row.id)
  return {
    key: keyOf(row),
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    type: row.type,
    labels: row.labels,
    assignee: row.assignee,
    agent: row.agent,
    repository: row.repositoryId ? ctx.repositoryNameById.get(row.repositoryId) ?? null : null,
    environment: row.environmentId ? ctx.environmentNameById.get(row.environmentId) ?? null : null,
    service: row.service,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    parent: row.parentId ? keyOf(all.find((entry) => entry.id === row.parentId) ?? row) : null,
    comments: notes.map((note) => ({
      key: note.sourceKey ?? `note-${note.id}`,
      actor: note.actor ?? 'someone',
      actorKind: note.actorKind,
      body: note.body,
    })),
    subtasks: await Promise.all(children.map((child) => toExampleTask(db, ctx, child, all, keyOf))),
  }
}
