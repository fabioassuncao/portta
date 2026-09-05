// GitHub App authentication, and the one file that touches the private key.
//
// **No Octokit.** The panel image resolves three runtime dependencies and that
// smallness is part of what makes it safe to run; this needs an RS256 JWT, a
// token exchange and a cache, which `node:crypto` and `fetch` already do. It is
// the same trade ADR 0011 made for apr1: about eighty lines we keep correct,
// against a dependency tree in a container that may be reachable over a VPN.
//
// An installation token lives for an hour. It is minted on demand, cached in
// memory with its expiry, and never persisted, logged or returned.

import { createSign } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

export class GitHubUnavailable extends Error {
  readonly status = 503
  readonly hint: string
  constructor(message = 'GitHub is unavailable', hint = 'the projection is still readable; Docker-backed pages are unaffected') {
    super(message)
    this.name = 'GitHubUnavailable'
    this.hint = hint
  }
}

export class GitHubRateLimited extends GitHubUnavailable {
  readonly resetAt: number
  constructor(resetAt: number) {
    super('the GitHub rate limit is exhausted', `the budget resets at ${new Date(resetAt * 1000).toISOString()}`)
    this.name = 'GitHubRateLimited'
    this.resetAt = resetAt
  }
}

export class GitHubForbidden extends Error {
  readonly status = 403
  readonly hint: string
  constructor(message: string, hint = 'check the App installation and its permissions') {
    super(message)
    this.name = 'GitHubForbidden'
    this.hint = hint
  }
}

export interface AppCredentials {
  appId: string
  /** Path to the PEM. The key itself is never a `.env` value. */
  privateKeyFile: string
  apiUrl: string
}

interface CachedToken {
  token: string
  /** Unix seconds. Refreshed early so a request never carries an expiring token. */
  expiresAt: number
}

const EARLY_REFRESH_SECONDS = 300

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url')
}

/** Reads the PEM on every use: rotating the key must not need a restart. */
export function readPrivateKey(path: string): string {
  const stats = statSync(path)
  if (!stats.isFile()) throw new GitHubForbidden(`${path} is not a file`, 'point GITHUB_APP_PRIVATE_KEY_FILE at the .pem GitHub gave you')
  return readFileSync(path, 'utf8')
}

/** True when only the owner can read the key, which is what mode 600 means. */
export function keyIsPrivate(path: string): boolean {
  try {
    return (statSync(path).mode & 0o077) === 0
  } catch {
    return false
  }
}

/**
 * A GitHub App JWT: RS256, at most ten minutes, issued sixty seconds in the
 * past because GitHub rejects a token whose `iat` is ahead of its clock.
 */
export function appJwt(credentials: AppCredentials, now = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: credentials.appId }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  signer.end()
  const signature = signer.sign(readPrivateKey(credentials.privateKeyFile)).toString('base64url')
  return `${header}.${payload}.${signature}`
}

export interface TokenSource {
  /** A token for one installation, minted or served from the in-memory cache. */
  installationToken(installationId: number): Promise<string>
  appJwt(): string
}

export class AppAuth implements TokenSource {
  private readonly credentials: AppCredentials
  private readonly tokens = new Map<number, CachedToken>()
  private readonly now: () => number

  constructor(credentials: AppCredentials, now: () => number = () => Math.floor(Date.now() / 1000)) {
    this.credentials = credentials
    this.now = now
  }

  appJwt(): string {
    return appJwt(this.credentials, this.now())
  }

  async installationToken(installationId: number): Promise<string> {
    const cached = this.tokens.get(installationId)
    if (cached && cached.expiresAt - EARLY_REFRESH_SECONDS > this.now()) return cached.token

    const response = await fetch(
      `${this.credentials.apiUrl}/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.appJwt()}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
      },
    ).catch((cause: Error) => {
      throw new GitHubUnavailable(`could not reach GitHub: ${cause.message}`)
    })

    if (response.status === 401 || response.status === 403) {
      throw new GitHubForbidden('GitHub refused the App credentials')
    }
    if (!response.ok) {
      throw new GitHubUnavailable(`GitHub returned ${response.status} minting an installation token`)
    }

    const body = (await response.json()) as { token?: string; expires_at?: string }
    if (typeof body.token !== 'string') {
      throw new GitHubUnavailable('GitHub returned no installation token')
    }

    const expiresAt = body.expires_at
      ? Math.floor(new Date(body.expires_at).getTime() / 1000)
      : this.now() + 3600
    this.tokens.set(installationId, { token: body.token, expiresAt })
    return body.token
  }

  /** Used by tests and by shutdown; a token must never outlive the process. */
  forget(): void {
    this.tokens.clear()
  }
}
