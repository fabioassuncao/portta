// Which issue an environment is running for, and why.
//
// Four sources with a stated precedence, each a pure function over data the
// panel already has — no Docker call, no GitHub call. The recorded source lets
// the UI say *"linked because this environment is on branch fix/182-tcp-proxy"*
// instead of presenting a mysterious association.
//
// An ambiguous match links nothing and offers the choice, following the same
// rule workspace adoption uses: an automatic link that is wrong is worse than
// none.

export type IssueLinkSource = 'manual' | 'label' | 'branch' | 'namespace'

export interface IssueCoordinate {
  repository: string | null
  number: number
}

export interface EnvironmentFacts {
  /** COMPOSE_PROJECT_NAME. */
  name: string
  namespace: string | null
  /** The optional `portta.issue` label, as the project declared it. */
  issueLabel: string | null
  /** Branch from the host Git scan, when there is one. */
  branch: string | null
  /** `owner/name` for this environment's remote, when it is known. */
  repository: string | null
}

export interface IssueLink {
  issue: IssueCoordinate
  source: IssueLinkSource
  branch: string | null
}

/** `owner/name#123`, or `#123` when the repository is unambiguous. */
export function parseIssueLabel(value: string | null): IssueCoordinate | null {
  if (!value) return null
  const trimmed = value.trim()
  const qualified = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(trimmed)
  if (qualified) return { repository: qualified[1]!.toLowerCase(), number: Number(qualified[2]) }
  const bare = /^#?(\d+)$/.exec(trimmed)
  if (bare) return { repository: null, number: Number(bare[1]) }
  return null
}

/**
 * `feat/182-…`, `fix/182-…`, `chore/182-…`, `issue-182`, `182-…`.
 *
 * Documented rather than guessed at: these are the shapes `docs/agent-guidelines.md`
 * and `portta namespace` already produce.
 */
export function issueFromBranch(branch: string | null): number | null {
  if (!branch) return null
  const patterns = [
    /^(?:feat|feature|fix|bugfix|hotfix|chore|refactor|docs|test)\/(\d+)(?:[-/]|$)/i,
    /^issue[-/](\d+)(?:[-/]|$)/i,
    /^(\d+)-/,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(branch.trim())
    if (match) return Number(match[1])
  }
  return null
}

/** What `portta namespace --suffix issue182` produces. */
export function issueFromNamespace(value: string | null): number | null {
  if (!value) return null
  const match = /issue[-_]?(\d+)$/i.exec(value.trim())
  return match ? Number(match[1]) : null
}

/**
 * Resolves one environment, first match wins.
 *
 * Manual is not handled here: it is a stored row that overrides everything, and
 * the caller applies it before asking. What is left is the inference, and the
 * order is the one the issue states: label, then branch, then namespace.
 */
export function inferIssueLink(environment: EnvironmentFacts): IssueLink | null {
  const labelled = parseIssueLabel(environment.issueLabel)
  if (labelled) {
    return {
      issue: { repository: labelled.repository ?? environment.repository, number: labelled.number },
      source: 'label',
      branch: environment.branch,
    }
  }

  const fromBranch = issueFromBranch(environment.branch)
  if (fromBranch !== null && environment.repository !== null) {
    return {
      issue: { repository: environment.repository, number: fromBranch },
      source: 'branch',
      branch: environment.branch,
    }
  }

  const fromNamespace =
    issueFromNamespace(environment.namespace) ?? issueFromNamespace(environment.name)
  if (fromNamespace !== null && environment.repository !== null) {
    return {
      issue: { repository: environment.repository, number: fromNamespace },
      source: 'namespace',
      branch: environment.branch,
    }
  }

  return null
}

export const LINK_REASON: Record<IssueLinkSource, (link: IssueLink, name: string) => string> = {
  manual: () => 'linked by hand',
  label: () => 'this environment declares portta.issue',
  branch: (link) => `this environment is on branch ${link.branch}`,
  namespace: (_link, name) => `this environment is namespaced ${name}`,
}
