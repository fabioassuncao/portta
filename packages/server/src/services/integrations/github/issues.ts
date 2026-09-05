// Fetching and normalising issues, and reading the sub-issue graph.

import type { GitHubClient } from './client.ts'
import { readMetadata, type MetadataSource, type Priority, type WorkflowStatus } from './metadata.ts'

export interface RawIssue {
  id: number
  node_id: string
  number: number
  title: string
  body?: string | null
  state: string
  state_reason?: string | null
  type?: { name?: string } | null
  labels?: Array<string | { name?: string }>
  assignees?: Array<{ login?: string }>
  milestone?: { number?: number; title?: string; state?: string } | null
  html_url: string
  pull_request?: unknown
  updated_at: string
  sub_issues_summary?: { total?: number; completed?: number }
}

export interface IssueRecord {
  githubId: number
  nodeId: string
  repositoryId: string
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  stateReason: string | null
  issueType: string | null
  workflowStatus: WorkflowStatus | null
  priority: Priority | null
  metadataSource: MetadataSource
  labels: string[]
  assignees: string[]
  milestone: { number: number | null; title: string; state: string } | null
  htmlUrl: string
  isPullRequest: boolean
  githubUpdatedAt: Date
}

export function labelNames(raw: RawIssue): string[] {
  return (raw.labels ?? [])
    .map((label) => (typeof label === 'string' ? label : (label.name ?? '')))
    .filter((name) => name !== '')
}

export function normaliseIssue(raw: RawIssue, repositoryId: string): IssueRecord {
  const labels = labelNames(raw)
  const metadata = readMetadata({ labels, issueType: raw.type?.name ?? null })

  return {
    githubId: raw.id,
    nodeId: raw.node_id,
    repositoryId,
    number: raw.number,
    title: raw.title,
    body: raw.body ?? null,
    state: raw.state === 'closed' ? 'closed' : 'open',
    stateReason: raw.state_reason ?? null,
    issueType: raw.type?.name ?? null,
    workflowStatus: metadata.status,
    priority: metadata.priority,
    metadataSource: metadata.source,
    labels,
    assignees: (raw.assignees ?? []).map((assignee) => assignee.login ?? '').filter((login) => login !== ''),
    milestone: raw.milestone
      ? {
          number: raw.milestone.number ?? null,
          title: raw.milestone.title ?? '',
          state: raw.milestone.state ?? 'open',
        }
      : null,
    htmlUrl: raw.html_url,
    // GitHub returns pull requests from the issues endpoint. They are projected
    // and flagged rather than dropped, so a later phase can use them without a
    // second sync.
    isPullRequest: raw.pull_request !== undefined && raw.pull_request !== null,
    githubUpdatedAt: new Date(raw.updated_at),
  }
}

export interface FetchIssuesOptions {
  /** Only issues updated at or after this instant, from the stored cursor. */
  since?: Date | null
  maxPages?: number
}

export async function fetchIssues(
  client: GitHubClient,
  installationId: number,
  fullName: string,
  options: FetchIssuesOptions = {},
): Promise<RawIssue[]> {
  const query = new URLSearchParams({
    state: 'all',
    per_page: '100',
    sort: 'updated',
    direction: 'asc',
  })
  if (options.since) query.set('since', options.since.toISOString())

  return client.paginate<RawIssue>(
    () => client.asInstallation<RawIssue[]>(installationId, `/repos/${fullName}/issues?${query}`),
    (url) => client.followAsInstallation<RawIssue[]>(installationId, url),
    options.maxPages ?? 10,
  )
}

export interface SubIssueLink {
  parentNumber: number
  childNumber: number
  position: number
}

export async function fetchSubIssues(
  client: GitHubClient,
  installationId: number,
  fullName: string,
  parentNumber: number,
): Promise<SubIssueLink[]> {
  const page = await client.asInstallation<RawIssue[]>(
    installationId,
    `/repos/${fullName}/issues/${parentNumber}/sub_issues?per_page=100`,
  )
  return page.data.map((child, position) => ({
    parentNumber,
    childNumber: child.number,
    position,
  }))
}

/**
 * Refuses a link that would close a cycle.
 *
 * The database check catches `a → a`; a longer path is only visible by walking
 * the graph, so it is walked here before the row is written. An issue that
 * cannot be its own ancestor is what keeps the UI's tree terminating.
 */
export function wouldCycle(
  links: ReadonlyArray<{ parentNumber: number; childNumber: number }>,
  candidate: { parentNumber: number; childNumber: number },
): boolean {
  if (candidate.parentNumber === candidate.childNumber) return true

  const parents = new Map<number, number[]>()
  for (const link of links) {
    const list = parents.get(link.childNumber) ?? []
    list.push(link.parentNumber)
    parents.set(link.childNumber, list)
  }

  // Walk up from the proposed parent: reaching the child means a cycle.
  const seen = new Set<number>()
  const queue = [candidate.parentNumber]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === candidate.childNumber) return true
    if (seen.has(current)) continue
    seen.add(current)
    queue.push(...(parents.get(current) ?? []))
  }
  return false
}

/** Drops links whose parent is not visible, so an unauthorised one degrades. */
export function visibleLinks(
  links: ReadonlyArray<SubIssueLink>,
  known: ReadonlySet<number>,
): SubIssueLink[] {
  const accepted: SubIssueLink[] = []
  for (const link of links) {
    if (!known.has(link.parentNumber) || !known.has(link.childNumber)) continue
    if (wouldCycle(accepted, link)) continue
    accepted.push(link)
  }
  return accepted
}
