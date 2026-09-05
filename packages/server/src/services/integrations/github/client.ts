// The REST surface the panel uses, and nothing wider.
//
// Every response carries the rate-limit budget in its headers, so the client
// reads it on every call and exposes it: exhaustion becomes a typed error that
// degrades to the projection rather than a 500 nobody can explain.

import { GitHubForbidden, GitHubRateLimited, GitHubUnavailable, type TokenSource } from './app.ts'

export interface RateLimit {
  limit: number | null
  remaining: number | null
  resetAt: number | null
  readAt: number | null
}

export const NO_RATE_LIMIT: RateLimit = { limit: null, remaining: null, resetAt: null, readAt: null }

export interface GitHubResponse<T> {
  data: T
  /** The `next` link, when GitHub paginated the answer. */
  next: string | null
}

function parseNext(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part.trim())
    if (match) return match[1] ?? null
  }
  return null
}

function readRateLimit(headers: Headers, now: number): RateLimit {
  const number = (name: string) => {
    const value = headers.get(name)
    if (value === null) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return {
    limit: number('x-ratelimit-limit'),
    remaining: number('x-ratelimit-remaining'),
    resetAt: number('x-ratelimit-reset'),
    readAt: now,
  }
}

export class GitHubClient {
  private readonly auth: TokenSource
  private readonly apiUrl: string
  private readonly timeoutMs: number
  private rateLimit: RateLimit = NO_RATE_LIMIT

  constructor(auth: TokenSource, apiUrl: string, timeoutMs = 8000) {
    this.auth = auth
    this.apiUrl = apiUrl.replace(/\/$/, '')
    this.timeoutMs = timeoutMs
  }

  budget(): RateLimit {
    return { ...this.rateLimit }
  }

  /** As the App itself: installations, and nothing that belongs to one. */
  async asApp<T>(path: string): Promise<GitHubResponse<T>> {
    return this.request<T>(path, `Bearer ${this.auth.appJwt()}`)
  }

  /** As one installation: only repositories that installation granted. */
  async asInstallation<T>(installationId: number, path: string): Promise<GitHubResponse<T>> {
    const token = await this.auth.installationToken(installationId)
    return this.request<T>(path, `Bearer ${token}`)
  }

  /** Follows `next` links to the end. Bounded so a runaway API cannot loop. */
  async paginate<T>(
    first: () => Promise<GitHubResponse<T[]>>,
    follow: (url: string) => Promise<GitHubResponse<T[]>>,
    maxPages = 20,
  ): Promise<T[]> {
    const all: T[] = []
    let page = await first()
    all.push(...page.data)
    for (let index = 1; index < maxPages && page.next !== null; index += 1) {
      page = await follow(page.next)
      all.push(...page.data)
    }
    return all
  }

  async followAsInstallation<T>(installationId: number, url: string): Promise<GitHubResponse<T>> {
    const token = await this.auth.installationToken(installationId)
    return this.request<T>(url, `Bearer ${token}`)
  }

  async postAsInstallation<T>(
    installationId: number,
    path: string,
    body: unknown,
  ): Promise<GitHubResponse<T>> {
    const token = await this.auth.installationToken(installationId)
    return this.request<T>(path, `Bearer ${token}`, { method: 'POST', body })
  }

  /** The writes. GitHub's answer is what the projection is updated from. */
  async patchAsInstallation<T>(
    installationId: number,
    path: string,
    body: unknown,
  ): Promise<GitHubResponse<T>> {
    const token = await this.auth.installationToken(installationId)
    return this.request<T>(path, `Bearer ${token}`, { method: 'PATCH', body })
  }

  private async request<T>(
    pathOrUrl: string,
    authorization: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<GitHubResponse<T>> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.apiUrl}${pathOrUrl}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          authorization,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'portta-panel',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      })
    } catch (cause) {
      throw new GitHubUnavailable(
        `could not reach GitHub: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    } finally {
      clearTimeout(timer)
    }

    this.rateLimit = readRateLimit(response.headers, Math.floor(Date.now() / 1000))

    if (response.status === 403 && this.rateLimit.remaining === 0) {
      throw new GitHubRateLimited(this.rateLimit.resetAt ?? Math.floor(Date.now() / 1000) + 60)
    }
    if (response.status === 401 || response.status === 403) {
      throw new GitHubForbidden(`GitHub refused the request: ${response.status}`)
    }
    if (response.status >= 500) {
      throw new GitHubUnavailable(`GitHub returned ${response.status}`)
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string }
      throw new GitHubForbidden(body.message ?? `GitHub returned ${response.status}`)
    }

    return {
      data: (await response.json()) as T,
      next: parseNext(response.headers.get('link')),
    }
  }
}
