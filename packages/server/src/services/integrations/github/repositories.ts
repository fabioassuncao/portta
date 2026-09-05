// Installations and repositories: fetch, normalise, project.
//
// The projection is what makes every later phase possible while GitHub is
// down, and `github_repositories` is the authorisation boundary: a repository
// absent from it is refused before a request is made.

import type { GitHubClient } from './client.ts'

export interface RawAccount {
  login?: string
  type?: string
  id?: number
}

export interface RawInstallation {
  id: number
  account?: RawAccount | null
  target_id?: number
  suspended_at?: string | null
  permissions?: Record<string, string>
}

export interface RawRepository {
  id: number
  node_id: string
  owner?: { login?: string } | null
  name: string
  full_name: string
  default_branch?: string | null
  private: boolean
  html_url: string
  archived?: boolean
}

export interface InstallationRecord {
  installationId: number
  accountLogin: string
  accountType: string
  targetId: number | null
  suspended: boolean
  permissions: Record<string, string>
}

export interface RepositoryRecord {
  githubId: number
  nodeId: string
  installationId: number
  owner: string
  name: string
  fullName: string
  defaultBranch: string | null
  private: boolean
  htmlUrl: string
  archived: boolean
}

export function normaliseInstallation(raw: RawInstallation): InstallationRecord {
  return {
    installationId: raw.id,
    accountLogin: raw.account?.login ?? `installation-${raw.id}`,
    accountType: raw.account?.type ?? 'Unknown',
    targetId: raw.target_id ?? raw.account?.id ?? null,
    suspended: Boolean(raw.suspended_at),
    permissions: raw.permissions ?? {},
  }
}

export function normaliseRepository(raw: RawRepository, installationId: number): RepositoryRecord {
  return {
    githubId: raw.id,
    nodeId: raw.node_id,
    installationId,
    owner: raw.owner?.login ?? raw.full_name.split('/')[0] ?? '',
    name: raw.name,
    fullName: raw.full_name,
    defaultBranch: raw.default_branch ?? null,
    private: raw.private,
    htmlUrl: raw.html_url,
    archived: Boolean(raw.archived),
  }
}

export async function fetchInstallations(client: GitHubClient): Promise<InstallationRecord[]> {
  const installations = await client.paginate<RawInstallation>(
    () => client.asApp<RawInstallation[]>('/app/installations?per_page=100'),
    (url) => client.asApp<RawInstallation[]>(url),
  )
  return installations.map(normaliseInstallation)
}

export async function fetchRepositories(
  client: GitHubClient,
  installationId: number,
): Promise<RepositoryRecord[]> {
  const pages = await client.paginate<RawRepository>(
    async () => {
      const page = await client.asInstallation<{ repositories: RawRepository[] }>(
        installationId,
        '/installation/repositories?per_page=100',
      )
      return { data: page.data.repositories ?? [], next: page.next }
    },
    async (url) => {
      const page = await client.followAsInstallation<{ repositories: RawRepository[] }>(installationId, url)
      return { data: page.data.repositories ?? [], next: page.next }
    },
  )
  return pages.map((repository) => normaliseRepository(repository, installationId))
}
