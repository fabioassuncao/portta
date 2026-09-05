// The projection, and only the projection.
//
// No method here accepts a token, and none returns one: an installation token
// lives for an hour in memory and has no row to be written to.
//
// Every write is idempotent by construction: running a sync twice leaves the
// same rows and moves `synced_at`, which is what lets the UI say how old an
// answer is.

import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import {
  type Db,
  githubInstallations,
  githubIssueRelationships,
  githubIssues,
  githubRepositories,
  githubSyncState,
} from 'portta-db'
import type { InstallationRecord, RepositoryRecord } from '../services/integrations/github/repositories.ts'
import type { IssueRecord } from '../services/integrations/github/issues.ts'

export interface StoredInstallation extends InstallationRecord {
  syncedAt: Date
}

export interface StoredRepository extends RepositoryRecord {
  id: string
  syncedAt: Date
}

export interface StoredIssue {
  id: string
  githubId: number
  nodeId: string
  repositoryId: string
  /** `owner/name`, joined so a card can be badged without a second query. */
  repository: string
  number: number
  title: string
  body: string | null
  state: string
  stateReason: string | null
  issueType: string | null
  workflowStatus: string | null
  priority: string | null
  metadataSource: string
  labels: string[]
  assignees: string[]
  milestone: { number: number | null; title: string; state: string } | null
  htmlUrl: string
  isPullRequest: boolean
  githubUpdatedAt: Date
  syncedAt: Date
}

export interface SyncState {
  scope: string
  cursor: string | null
  lastSyncedAt: Date | null
  lastError: string | null
}

const ISSUE_COLUMNS = {
  id: githubIssues.id,
  githubId: githubIssues.githubId,
  nodeId: githubIssues.nodeId,
  repositoryId: githubIssues.repositoryId,
  repository: githubRepositories.fullName,
  number: githubIssues.number,
  title: githubIssues.title,
  body: githubIssues.body,
  state: githubIssues.state,
  stateReason: githubIssues.stateReason,
  issueType: githubIssues.issueType,
  workflowStatus: githubIssues.workflowStatus,
  priority: githubIssues.priority,
  metadataSource: githubIssues.metadataSource,
  labels: githubIssues.labels,
  assignees: githubIssues.assignees,
  milestone: githubIssues.milestone,
  htmlUrl: githubIssues.htmlUrl,
  isPullRequest: githubIssues.isPullRequest,
  githubUpdatedAt: githubIssues.githubUpdatedAt,
  syncedAt: githubIssues.syncedAt,
} as const

type IssueSelection = {
  [K in keyof typeof ISSUE_COLUMNS]: unknown
}

function toIssue(row: IssueSelection): StoredIssue {
  const issue = row as unknown as StoredIssue & { id: number; repositoryId: number }
  return { ...issue, id: String(issue.id), repositoryId: String(issue.repositoryId) }
}

export class GitHubRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async upsertInstallation(installation: InstallationRecord): Promise<void> {
    await this.db
      .insert(githubInstallations)
      .values({ ...installation, syncedAt: new Date() })
      .onConflictDoUpdate({
        target: githubInstallations.installationId,
        set: {
          accountLogin: sql`excluded.account_login`,
          accountType: sql`excluded.account_type`,
          targetId: sql`excluded.target_id`,
          suspended: sql`excluded.suspended`,
          permissions: sql`excluded.permissions`,
          syncedAt: sql`now()`,
        },
      })
  }

  async upsertRepository(repository: RepositoryRecord): Promise<void> {
    await this.db
      .insert(githubRepositories)
      .values({ ...repository, syncedAt: new Date() })
      .onConflictDoUpdate({
        target: githubRepositories.githubId,
        set: {
          nodeId: sql`excluded.node_id`,
          installationId: sql`excluded.installation_id`,
          owner: sql`excluded.owner`,
          name: sql`excluded.name`,
          fullName: sql`excluded.full_name`,
          defaultBranch: sql`excluded.default_branch`,
          private: sql`excluded.private`,
          htmlUrl: sql`excluded.html_url`,
          archived: sql`excluded.archived`,
          syncedAt: sql`now()`,
        },
      })
  }

  async listInstallations(): Promise<StoredInstallation[]> {
    const rows = await this.db
      .select({
        installationId: githubInstallations.installationId,
        accountLogin: githubInstallations.accountLogin,
        accountType: githubInstallations.accountType,
        targetId: githubInstallations.targetId,
        suspended: githubInstallations.suspended,
        permissions: githubInstallations.permissions,
        syncedAt: githubInstallations.syncedAt,
      })
      .from(githubInstallations)
      .orderBy(asc(githubInstallations.accountLogin))
    return rows as StoredInstallation[]
  }

  async listRepositories(): Promise<StoredRepository[]> {
    const rows = await this.db.select().from(githubRepositories).orderBy(asc(githubRepositories.fullName))
    return rows.map((row) => ({ ...row, id: String(row.id) })) as StoredRepository[]
  }

  async findRepository(fullName: string): Promise<StoredRepository | null> {
    const [row] = await this.db.select().from(githubRepositories).where(eq(githubRepositories.fullName, fullName))
    return row ? ({ ...row, id: String(row.id) } as StoredRepository) : null
  }

  /** Removes what an installation no longer grants, so the boundary shrinks too. */
  async pruneRepositories(installationId: number, keep: number[]): Promise<number> {
    const rows = await this.db
      .delete(githubRepositories)
      .where(
        keep.length === 0
          ? eq(githubRepositories.installationId, installationId)
          : and(
              eq(githubRepositories.installationId, installationId),
              notInArray(githubRepositories.githubId, keep),
            ),
      )
      .returning({ githubId: githubRepositories.githubId })
    return rows.length
  }

  async pruneInstallations(keep: number[]): Promise<number> {
    const rows = await this.db
      .delete(githubInstallations)
      .where(keep.length === 0 ? undefined : notInArray(githubInstallations.installationId, keep))
      .returning({ installationId: githubInstallations.installationId })
    return rows.length
  }

  async upsertIssue(issue: IssueRecord): Promise<string> {
    const [row] = await this.db
      .insert(githubIssues)
      .values({
        ...issue,
        repositoryId: Number(issue.repositoryId),
        state: issue.state as 'open' | 'closed',
        metadataSource: issue.metadataSource as 'fields' | 'labels' | 'none',
        labels: [...issue.labels],
        assignees: [...issue.assignees],
        milestone: issue.milestone,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: githubIssues.githubId,
        set: {
          title: sql`excluded.title`,
          body: sql`excluded.body`,
          state: sql`excluded.state`,
          stateReason: sql`excluded.state_reason`,
          issueType: sql`excluded.issue_type`,
          workflowStatus: sql`excluded.workflow_status`,
          priority: sql`excluded.priority`,
          metadataSource: sql`excluded.metadata_source`,
          labels: sql`excluded.labels`,
          assignees: sql`excluded.assignees`,
          milestone: sql`excluded.milestone`,
          htmlUrl: sql`excluded.html_url`,
          isPullRequest: sql`excluded.is_pull_request`,
          githubUpdatedAt: sql`excluded.github_updated_at`,
          syncedAt: sql`now()`,
        },
      })
      .returning({ id: githubIssues.id })
    return String(row!.id)
  }

  private issueQuery() {
    return this.db
      .select(ISSUE_COLUMNS)
      .from(githubIssues)
      .innerJoin(githubRepositories, eq(githubRepositories.id, githubIssues.repositoryId))
  }

  async listIssues(
    filter: { repositoryIds?: string[]; state?: string; limit?: number } = {},
  ): Promise<StoredIssue[]> {
    const where = [
      eq(githubIssues.isPullRequest, false),
      filter.repositoryIds ? inArray(githubIssues.repositoryId, filter.repositoryIds.map(Number)) : undefined,
      filter.state ? eq(githubIssues.state, filter.state as 'open' | 'closed') : undefined,
    ].filter((clause) => clause !== undefined)
    const rows = await this.issueQuery()
      .where(and(...where))
      .orderBy(desc(githubIssues.githubUpdatedAt))
      .limit(Math.min(filter.limit ?? 200, 500))
    return rows.map(toIssue)
  }

  async findIssue(issueId: string): Promise<StoredIssue | null> {
    if (!/^\d+$/.test(issueId)) return null
    const [row] = await this.issueQuery().where(eq(githubIssues.id, Number(issueId)))
    return row ? toIssue(row) : null
  }

  async findIssueByNumber(repositoryId: string, number: number): Promise<StoredIssue | null> {
    const [row] = await this.issueQuery().where(
      and(eq(githubIssues.repositoryId, Number(repositoryId)), eq(githubIssues.number, number)),
    )
    return row ? toIssue(row) : null
  }

  /** Pull requests arrive through the issues endpoint and are flagged there. */
  async listPullRequests(
    repositoryId: string,
  ): Promise<{ number: number; title: string; state: string; htmlUrl: string }[]> {
    return this.db
      .select({
        number: githubIssues.number,
        title: githubIssues.title,
        state: githubIssues.state,
        htmlUrl: githubIssues.htmlUrl,
      })
      .from(githubIssues)
      .where(
        and(
          eq(githubIssues.repositoryId, Number(repositoryId)),
          eq(githubIssues.isPullRequest, true),
          eq(githubIssues.state, 'open'),
        ),
      )
      .orderBy(asc(githubIssues.number))
  }

  async replaceRelationships(
    repositoryId: string,
    links: { parentId: string; childId: string; position: number }[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const parents = tx
        .select({ id: githubIssues.id })
        .from(githubIssues)
        .where(eq(githubIssues.repositoryId, Number(repositoryId)))
      await tx.delete(githubIssueRelationships).where(inArray(githubIssueRelationships.parentId, parents))
      for (const link of links) {
        await tx
          .insert(githubIssueRelationships)
          .values({
            parentId: Number(link.parentId),
            childId: Number(link.childId),
            position: link.position,
          })
          .onConflictDoUpdate({
            target: [githubIssueRelationships.parentId, githubIssueRelationships.childId],
            set: { position: sql`excluded.position` },
          })
      }
    })
  }

  async listRelationships(): Promise<{ parentId: string; childId: string; position: number }[]> {
    const rows = await this.db
      .select()
      .from(githubIssueRelationships)
      .orderBy(asc(githubIssueRelationships.position))
    return rows.map((row) => ({
      parentId: String(row.parentId),
      childId: String(row.childId),
      position: row.position,
    }))
  }

  async recordSync(scope: string, state: { cursor?: string | null; error?: string | null }): Promise<void> {
    await this.db
      .insert(githubSyncState)
      .values({
        scope,
        cursor: state.cursor ?? null,
        lastSyncedAt: new Date(),
        lastError: state.error ?? null,
      })
      .onConflictDoUpdate({
        target: githubSyncState.scope,
        set: {
          cursor: sql`excluded.cursor`,
          lastSyncedAt: sql`excluded.last_synced_at`,
          lastError: sql`excluded.last_error`,
        },
      })
  }

  listSyncState(): Promise<SyncState[]> {
    return this.db.select().from(githubSyncState).orderBy(asc(githubSyncState.scope))
  }
}
