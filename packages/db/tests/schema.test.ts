// What the database refuses.
//
// Every rule here is also enforced in the panel, and that is the point: a limit
// that lives in one process is not a limit. These tests pin the second copy —
// the one that still holds when a migration, a psql session or a future service
// writes a row.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createTestDb, type TestDatabase } from '../src/test-db.ts'
import { apiKeys, sessions, users } from '../src/schema/auth.ts'
import { projectMembers } from '../src/schema/access.ts'
import { environments, projectEnvironments } from '../src/schema/environments.ts'
import { githubRepositories } from '../src/schema/github.ts'
import { projects, repositories } from '../src/schema/projects.ts'
import { taskEnvironments, tasks } from '../src/schema/tasks.ts'

/**
 * Drizzle wraps a driver error in one that repeats the statement, so the
 * constraint's name — the thing worth asserting — is in `cause`. This walks the
 * chain and returns everything it said, so a test can name the constraint it
 * expects rather than the query it sent.
 */
async function tableNames(database: TestDatabase): Promise<string[]> {
  const result = await database.db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  )
  return result.rows.map((row) => row.table_name)
}

async function refusalFor(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    const parts: string[] = []
    let current: unknown = error
    while (current instanceof Error) {
      parts.push(current.message)
      current = (current as { cause?: unknown }).cause
    }
    return parts.join(' | ')
  }
  throw new Error('the database accepted a row it should have refused')
}

let open: TestDatabase
const db = () => open.db

beforeEach(async () => {
  open = await createTestDb()
})

afterEach(async () => {
  await open.close()
})

async function aUser(id: string, email: string) {
  await db().insert(users).values({ id, name: id, email })
  return id
}

async function aProject(slug: string): Promise<number> {
  const [row] = await db().insert(projects).values({ slug, name: slug }).returning({ id: projects.id })
  return row!.id
}

describe('the vocabularies the database owns', () => {
  it('refuses a task status nothing in portta-core names', async () => {
    const projectId = await aProject('alpha')
    const refusal = await refusalFor(
      db().execute(sql`INSERT INTO tasks (project_id, title, status) VALUES (${projectId}, 'x', 'shipped')`),
    )
    expect(refusal).toMatch(/invalid input value for enum/i)
  })

  it('refuses a role nothing in portta-core names', async () => {
    const refusal = await refusalFor(
      db().execute(sql`INSERT INTO users (id, name, email, role) VALUES ('u', 'u', 'u@x', 'superuser')`),
    )
    expect(refusal).toMatch(/invalid input value for enum/i)
  })

  it('accepts every role portta-core names', async () => {
    for (const role of ['owner', 'admin', 'developer', 'viewer'] as const) {
      await db().insert(users).values({ id: role, name: role, email: `${role}@x`, role })
    }
    expect(await db().select().from(users)).toHaveLength(4)
  })
})

describe('the checks the database keeps', () => {
  it('refuses a task whose title is only whitespace', async () => {
    const projectId = await aProject('alpha')
    const refusal = await refusalFor(db().insert(tasks).values({ projectId, title: '   ' }))
    expect(refusal).toMatch(/tasks_title_check/)
  })

  it('refuses a project path that walks up out of Projects Home', async () => {
    const refusal = await refusalFor(
      db().insert(projects).values({ slug: 'a', name: 'A', relativePath: '../escape' }),
    )
    expect(refusal).toMatch(/projects_relative_path_check/)
  })

  it('refuses an attachment larger than the panel would accept', async () => {
    const projectId = await aProject('alpha')
    const [task] = await db().insert(tasks).values({ projectId, title: 'a' }).returning({ id: tasks.id })
    const refusal = await refusalFor(
      db().execute(
        sql`INSERT INTO task_attachments (task_id, filename, content_type, size_bytes, content)
            VALUES (${task!.id}, 'big.bin', 'application/octet-stream', 10485761, '\\x00'::bytea)`,
      ),
    )
    expect(refusal).toMatch(/task_attachments_size_bytes_check/)
  })

  it('refuses a task that is its own parent', async () => {
    const projectId = await aProject('alpha')
    const [task] = await db().insert(tasks).values({ projectId, title: 'a' }).returning({ id: tasks.id })
    const refusal = await refusalFor(
      db().update(tasks).set({ parentId: task!.id }).where(eq(tasks.id, task!.id)),
    )
    expect(refusal).toMatch(/tasks_parent_check/)
  })

  it('refuses a second instance row', async () => {
    await db().execute(sql`INSERT INTO instance (name) VALUES ('first')`)
    const refusal = await refusalFor(db().execute(sql`INSERT INTO instance (name) VALUES ('second')`))
    expect(refusal).toMatch(/instance_singleton_unique|duplicate key/i)
  })
})

describe('what the schema deliberately does not hold', () => {
  // ADR 0031: persist decisions, never observations. Container state, health,
  // ports, networks, URLs and logs are rebuilt from Docker on every request and
  // have no table; a cache of a remote source of truth (the GitHub projection)
  // is a third category, and every row in it records when it was collected.
  it('has no table for anything the panel can observe', async () => {
    const tables = await tableNames(open)
    for (const forbidden of ['containers', 'urls', 'health', 'ports', 'networks', 'logs']) {
      expect(tables, forbidden).not.toContain(forbidden)
    }
  })

  // Comments are large, they change often, and a link to GitHub beats a worse
  // comment reader — the same reasoning ADR 0010 used for commit lists.
  it('does not project GitHub comments', async () => {
    expect(await tableNames(open)).not.toContain('github_issue_comments')
  })

  // Speculation is not a schema: a table nothing writes is a promise the
  // product has not made.
  it('has no table for work nothing yet does', async () => {
    expect(await tableNames(open)).not.toContain('agent_runs')
  })

  it('refuses a one-step sub-issue cycle in the database itself', async () => {
    const refusal = await refusalFor(
      db().execute(sql`INSERT INTO github_issue_relationships (parent_id, child_id) VALUES (1, 1)`),
    )
    expect(refusal).toMatch(/github_issue_relationships_check/)
  })

  // The panel says *this status came from a label, not from a field*, which
  // changes what a write will do. An unprojected issue is honest about that.
  it('records where an issue’s status came from, defaulting to none', async () => {
    await db().execute(sql`
      INSERT INTO github_installations (installation_id, account_login, account_type)
      VALUES (7, 'acme', 'Organization')`)
    await db().execute(sql`
      INSERT INTO github_repositories (github_id, node_id, installation_id, owner, name, full_name, private, html_url)
      VALUES (1, 'R_1', 7, 'acme', 'api', 'acme/api', false, 'https://github.com/acme/api')`)
    await db().execute(sql`
      INSERT INTO github_issues (github_id, node_id, repository_id, number, title, state, html_url, github_updated_at)
      VALUES (1, 'I_1', 1, 1, 'x', 'open', 'https://github.com/acme/api/issues/1', now())`)
    const rows = await db().execute<{ metadata_source: string }>(sql`SELECT metadata_source FROM github_issues`)
    expect(rows.rows[0]?.metadata_source).toBe('none')

    const refusal = await refusalFor(
      db().execute(sql`UPDATE github_issues SET metadata_source = 'guessed'`),
    )
    expect(refusal).toMatch(/invalid input value for enum/i)
  })
})

describe('what a removal takes with it', () => {
  it('takes a user’s sessions, tokens and memberships', async () => {
    const userId = await aUser('u1', 'u1@example.test')
    const projectId = await aProject('alpha')
    await db().insert(sessions).values({
      token: 't', userId, expiresAt: new Date(Date.now() + 60_000),
    })
    await db().insert(apiKeys).values({ key: 'hash', referenceId: userId })
    await db().insert(projectMembers).values({ projectId, userId })

    await db().delete(users).where(eq(users.id, userId))

    expect(await db().select().from(sessions)).toHaveLength(0)
    expect(await db().select().from(apiKeys)).toHaveLength(0)
    expect(await db().select().from(projectMembers)).toHaveLength(0)
  })

  // The attribution survives the person: `created_by` keeps the name, so a task
  // does not become anonymous when somebody leaves.
  it('leaves a task standing when the user who created it is removed', async () => {
    const userId = await aUser('u2', 'u2@example.test')
    const projectId = await aProject('alpha')
    await db().insert(tasks).values({ projectId, title: 'a task', createdBy: 'u2', createdByUserId: userId })

    await db().delete(users).where(eq(users.id, userId))

    const [row] = await db().select().from(tasks)
    expect(row?.title).toBe('a task')
    expect(row?.createdByUserId).toBeNull()
    expect(row?.createdBy).toBe('u2')
  })

  it('takes a project’s tasks and memberships', async () => {
    const userId = await aUser('u3', 'u3@example.test')
    const projectId = await aProject('alpha')
    await db().insert(tasks).values({ projectId, title: 'a' })
    await db().insert(projectMembers).values({ projectId, userId })

    await db().delete(projects).where(eq(projects.id, projectId))

    expect(await db().select().from(tasks)).toHaveLength(0)
    expect(await db().select().from(projectMembers)).toHaveLength(0)
  })
})

describe('what belongs to what', () => {
  // One GitHub repository, one Project. Two Projects claiming one repository
  // would make "whose code is this" unanswerable.
  it('gives a GitHub repository to at most one Project', async () => {
    const first = await aProject('alpha')
    const second = await aProject('beta')
    await db().execute(sql`
      INSERT INTO github_installations (installation_id, account_login, account_type)
      VALUES (7, 'acme', 'Organization')`)
    const [github] = await db()
      .insert(githubRepositories)
      .values({
        githubId: 1, nodeId: 'R_1', installationId: 7, owner: 'acme', name: 'api',
        fullName: 'acme/api', private: false, htmlUrl: 'https://github.com/acme/api',
      })
      .returning({ id: githubRepositories.id })

    await db().insert(repositories).values({ projectId: first, name: 'api', githubRepositoryId: github!.id })
    const refusal = await refusalFor(
      db().insert(repositories).values({ projectId: second, name: 'api', githubRepositoryId: github!.id }),
    )
    expect(refusal).toMatch(/repositories_github_repository_id_unique|duplicate key/i)
  })

  // A repository is a decision; which environment its code is running in is an
  // observation, resolved through the scan index at request time. A column here
  // would turn the observation into a stale decision.
  it('never points a repository at an environment', async () => {
    const result = await db().execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'repositories'`,
    )
    expect(result.rows.map((row) => row.column_name)).not.toContain('environment_id')
  })

  it('records why a Project adopted an environment, and refuses a reason nothing names', async () => {
    const projectId = await aProject('alpha')
    const [environment] = await db()
      .insert(environments)
      .values({ composeProject: 'one' })
      .returning({ id: environments.id })
    const refusal = await refusalFor(
      db().execute(sql`
        INSERT INTO project_environments (project_id, environment_id, source)
        VALUES (${projectId}, ${environment!.id}, 'guessed')`),
    )
    expect(refusal).toMatch(/invalid input value for enum/i)
  })
})

describe('an environment runs for at most one task', () => {
  it('gives a task many environments and an environment one task', async () => {
    const projectId = await aProject('alpha')
    const [first] = await db().insert(tasks).values({ projectId, title: 'first' }).returning({ id: tasks.id })
    const [second] = await db().insert(tasks).values({ projectId, title: 'second' }).returning({ id: tasks.id })
    const seen = await db()
      .insert(environments)
      .values([{ composeProject: 'one' }, { composeProject: 'two' }])
      .returning({ id: environments.id })

    // One task, two environments: normal.
    await db().insert(taskEnvironments).values([
      { taskId: first!.id, environmentId: seen[0]!.id, source: 'manual' },
      { taskId: first!.id, environmentId: seen[1]!.id, source: 'branch' },
    ])

    // Two tasks, one environment: "what is this running for" would have two
    // answers, so the database refuses it.
    const refusal = await refusalFor(
      db().insert(taskEnvironments).values({ taskId: second!.id, environmentId: seen[0]!.id, source: 'manual' }),
    )
    expect(refusal).toMatch(/task_environments_one_task_per_env|duplicate key/i)
  })

  it('records why the link exists, and refuses a reason nothing names', async () => {
    const projectId = await aProject('alpha')
    const [task] = await db().insert(tasks).values({ projectId, title: 'a' }).returning({ id: tasks.id })
    const [environment] = await db()
      .insert(environments)
      .values({ composeProject: 'one' })
      .returning({ id: environments.id })
    const refusal = await refusalFor(
      db().execute(sql`
        INSERT INTO task_environments (task_id, environment_id, source)
        VALUES (${task!.id}, ${environment!.id}, 'guessed')`),
    )
    expect(refusal).toMatch(/invalid input value for enum/i)
  })
})

describe('an environment belongs to at most one project', () => {
  it('refuses a second project claiming it', async () => {
    const first = await aProject('alpha')
    const second = await aProject('beta')
    const [environment] = await db()
      .insert(environments)
      .values({ composeProject: 'shared' })
      .returning({ id: environments.id })

    await db().insert(projectEnvironments).values({
      projectId: first, environmentId: environment!.id, source: 'manual',
    })
    const refusal = await refusalFor(
      db().insert(projectEnvironments).values({
        projectId: second, environmentId: environment!.id, source: 'manual',
      }),
    )
    expect(refusal).toMatch(/project_environments_one_project_per_env|duplicate key/i)
  })
})
