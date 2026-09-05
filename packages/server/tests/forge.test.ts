import { describe, expect, it } from 'vitest'
import { branchUrl, commitUrl, parseRemote } from '../src/services/forge.ts'

describe('parseRemote', () => {
  it('reads the shapes people actually have in origin', () => {
    const cases: [string, string, string][] = [
      ['git@github.com:owner/repo.git', 'github.com', 'owner/repo'],
      ['https://github.com/owner/repo.git', 'github.com', 'owner/repo'],
      ['https://github.com/owner/repo', 'github.com', 'owner/repo'],
      ['ssh://git@github.com/owner/repo.git', 'github.com', 'owner/repo'],
      ['https://user@bitbucket.org/owner/repo.git', 'bitbucket.org', 'owner/repo'],
      ['git@gitlab.example.com:group/sub/repo.git', 'gitlab.example.com', 'group/sub/repo'],
      ['git://git.example.com/owner/repo.git', 'git.example.com', 'owner/repo'],
    ]
    for (const [url, host, slug] of cases) {
      expect(parseRemote(url)).toMatchObject({ host, slug })
    }
  })

  it('takes the bare owner/name a portta.repo label may carry', () => {
    expect(parseRemote('owner/repo')).toMatchObject({
      host: 'github.com',
      slug: 'owner/repo',
      kind: 'github',
      repoUrl: 'https://github.com/owner/repo',
    })
  })

  it('drops a port from the link a browser should follow', () => {
    expect(parseRemote('ssh://git@github.com:2222/owner/repo.git')?.repoUrl).toBe(
      'https://github.com/owner/repo',
    )
  })

  it('recognises self-hosted forges by name', () => {
    expect(parseRemote('git@gitlab.acme.dev:a/b.git')?.kind).toBe('gitlab')
    expect(parseRemote('git@github.acme.dev:a/b.git')?.kind).toBe('github')
    expect(parseRemote('git@git.acme.dev:a/b.git')?.kind).toBe('unknown')
  })

  it('returns nothing rather than guessing', () => {
    for (const value of ['', '   ', 'not a remote at all', 'https://', '/local/path']) {
      expect(parseRemote(value)).toBeNull()
    }
  })
})

describe('derived links', () => {
  const github = parseRemote('git@github.com:owner/repo.git')!
  const gitlab = parseRemote('https://gitlab.com/group/repo.git')!
  const bitbucket = parseRemote('git@bitbucket.org:owner/repo.git')!
  const unknown = parseRemote('git@git.acme.dev:owner/repo.git')!

  it("follows each forge's own shape", () => {
    expect(commitUrl(github, '9f2c1ab')).toBe('https://github.com/owner/repo/commit/9f2c1ab')
    expect(commitUrl(gitlab, '9f2c1ab')).toBe('https://gitlab.com/group/repo/commit/9f2c1ab')
    expect(commitUrl(bitbucket, '9f2c1ab')).toBe('https://bitbucket.org/owner/repo/commits/9f2c1ab')
    expect(branchUrl(github, 'feature/59')).toBe('https://github.com/owner/repo/tree/feature/59')
    expect(branchUrl(gitlab, 'feature/59')).toBe('https://gitlab.com/group/repo/-/tree/feature/59')
  })

  it('keeps the repository link and drops the rest on a forge it cannot place', () => {
    // A wrong link is worse than a missing one.
    expect(unknown.repoUrl).toBe('https://git.acme.dev/owner/repo')
    expect(commitUrl(unknown, '9f2c1ab')).toBeNull()
    expect(branchUrl(unknown, 'main')).toBeNull()
  })

  it('escapes a branch name without mangling its slashes', () => {
    expect(branchUrl(github, 'feature/a b')).toBe('https://github.com/owner/repo/tree/feature/a%20b')
  })
})
