// The panel's GitHub integration, shaped exactly like `Database`.
//
// It is optional, it is off by default, and it never stops the panel from
// starting or a Docker-backed page from answering. Unconfigured is a state it
// reports rather than an error it throws, and an outage degrades to whatever
// was last projected, marked with its age.

import { AppAuth, GitHubForbidden, GitHubUnavailable, keyIsPrivate, type AppCredentials } from './app.ts'
import { GitHubClient, NO_RATE_LIMIT, type RateLimit } from './client.ts'
import { fetchInstallations, fetchRepositories } from './repositories.ts'
import type { Database } from '../../../db/index.ts'

export interface GitHubStatus {
  configured: boolean
  available: boolean
  reason: string | null
  checkedAt: number | null
  appId: string | null
  apiUrl: string
  rateLimit: RateLimit
}

export interface SyncResult {
  installations: number
  repositories: number
  removed: number
}

export interface GitHubOptions {
  enabled: boolean
  appId: string
  privateKeyFile: string
  apiUrl: string
  timeoutMs?: number
}

export class GitHubIntegration {
  private readonly options: GitHubOptions
  private readonly auth: AppAuth | null
  private readonly client: GitHubClient | null
  private state: GitHubStatus

  constructor(options: GitHubOptions) {
    this.options = options
    const configured = options.enabled && options.appId !== '' && options.privateKeyFile !== ''

    const credentials: AppCredentials = {
      appId: options.appId,
      privateKeyFile: options.privateKeyFile,
      apiUrl: options.apiUrl,
    }
    this.auth = configured ? new AppAuth(credentials) : null
    this.client = this.auth ? new GitHubClient(this.auth, options.apiUrl, options.timeoutMs) : null

    this.state = {
      configured,
      available: false,
      reason: configured ? 'not checked yet' : 'GITHUB_APP_ENABLED is off',
      checkedAt: null,
      appId: configured ? options.appId : null,
      apiUrl: options.apiUrl,
      rateLimit: NO_RATE_LIMIT,
    }
  }

  status(): GitHubStatus {
    return { ...this.state, rateLimit: this.client?.budget() ?? this.state.rateLimit }
  }

  /** Throws the same 503 shape the database does when it cannot be used. */
  require(): GitHubClient {
    if (!this.state.configured || this.client === null) {
      throw new GitHubUnavailable(
        'the GitHub App is not configured',
        'set GITHUB_APP_ENABLED, GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_FILE; see docs/github.md',
      )
    }
    return this.client
  }

  /** A key anyone on the host can read is a misconfiguration, not a warning. */
  keyIsPrivate(): boolean {
    return this.state.configured ? keyIsPrivate(this.options.privateKeyFile) : true
  }

  /**
   * Projects installations and their repositories into the database.
   *
   * Idempotent: two runs leave the same rows and move `synced_at`. What an
   * installation no longer grants is pruned, so the authorisation boundary
   * shrinks as well as grows.
   */
  async sync(db: Database): Promise<SyncResult> {
    const client = this.require()
    let removed = 0

    try {
      const installations = await fetchInstallations(client)
      for (const installation of installations) await db.github.upsertInstallation(installation)
      removed += await db.github.pruneInstallations(installations.map((entry) => entry.installationId))
      await db.github.recordSync('installations', { error: null })

      let repositories = 0
      for (const installation of installations) {
        if (installation.suspended) continue
        const granted = await fetchRepositories(client, installation.installationId)
        for (const repository of granted) await db.github.upsertRepository(repository)
        removed += await db.github.pruneRepositories(
          installation.installationId,
          granted.map((repository) => repository.githubId),
        )
        repositories += granted.length
      }
      await db.github.recordSync('repositories', { error: null })

      this.markAvailable()
      return { installations: installations.length, repositories, removed }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db.github.recordSync('repositories', { error: message }).catch(() => undefined)
      this.markUnavailable(message)
      throw error
    }
  }

  /** One cheap call that says whether the App can reach GitHub at all. */
  async check(): Promise<GitHubStatus> {
    if (!this.state.configured || this.client === null) return this.status()
    try {
      await this.client.asApp('/app')
      this.markAvailable()
    } catch (error) {
      this.markUnavailable(error instanceof Error ? error.message : String(error))
    }
    return this.status()
  }

  private markAvailable(): void {
    this.state = {
      ...this.state,
      available: true,
      reason: null,
      checkedAt: Math.floor(Date.now() / 1000),
    }
  }

  private markUnavailable(reason: string): void {
    this.state = {
      ...this.state,
      available: false,
      reason,
      checkedAt: Math.floor(Date.now() / 1000),
    }
  }
}

export function unavailableGitHubStatus(configured: boolean, reason: string, apiUrl: string): GitHubStatus {
  return {
    configured,
    available: false,
    reason,
    checkedAt: null,
    appId: null,
    apiUrl,
    rateLimit: NO_RATE_LIMIT,
  }
}

export { GitHubUnavailable, GitHubForbidden }
export { GitHubRateLimited } from './app.ts'
