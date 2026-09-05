import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import { GitStatusLine } from '@/components/entities/git-status-line'
import type { ProjectGit } from 'portta-contracts'

function collected(overrides: Partial<ProjectGit> = {}): ProjectGit {
  return {
    project: 'alpha', collected: true, collectedAt: Math.floor(Date.now() / 1000) - 240, ageSeconds: 240,
    stale: false, staleAfterSeconds: 600, workingDir: '/srv/dev/alpha',
    git: {
      branch: 'feature/59', detached: false,
      head: { sha: '9f2c1abfeed', shortSha: '9f2c1ab', subject: 'Add totals', author: 'Someone', date: 0 },
      staged: 2, unstaged: 5, untracked: 0, unmerged: 0, dirty: true,
      upstream: 'origin/feature/59', ahead: 3, behind: 0, remote: 'git@github.com:owner/repo.git',
    },
    remote: { url: 'git@github.com:owner/repo.git', host: 'github.com', slug: 'owner/repo', kind: 'github', repoUrl: 'https://github.com/owner/repo' },
    links: { repo: 'https://github.com/owner/repo', commit: 'https://github.com/owner/repo/commit/9f2c1abfeed', branch: 'https://github.com/owner/repo/tree/feature/59' },
    forge: null, reason: null, refreshCommand: './bin/portta repos scan --environment alpha',
    ...overrides,
  }
}

describe('the git status line', () => {
  it('says branch, HEAD, tree and drift on one line', () => {
    const { container } = renderWithQuery(<GitStatusLine git={collected()} />, 'en')
    expect(screen.getByText('feature/59').closest('a')).toHaveAttribute('href', 'https://github.com/owner/repo/tree/feature/59')
    expect(screen.getByText('9f2c1ab')).toBeInTheDocument()
    expect(screen.getByText('7 uncommitted changes')).toBeInTheDocument()
    expect(screen.getByText('3 ahead')).toBeInTheDocument()
    expect(container.querySelector('[data-git-state="dirty"]')).not.toBeNull()
  })
  it('marks stale over clean', () => {
    const git = { ...collected().git!, staged: 0, unstaged: 0, dirty: false }
    const { container } = renderWithQuery(<GitStatusLine git={collected({ git, stale: true })} />, 'en')
    expect(container.querySelector('[data-git-state="stale"]')).not.toBeNull()
    expect(container.querySelector('[title*="older than"]')).not.toBeNull()
  })
  it('shows the host command when nothing was collected, unless told not to', () => {
    renderWithQuery(<GitStatusLine git={collected({ collected: false, git: null })} />, 'en')
    expect(screen.getByText('./bin/portta repos scan --environment alpha')).toBeInTheDocument()
    const { container } = renderWithQuery(<GitStatusLine git={collected({ collected: false, git: null })} refreshHint={false} />, 'en')
    expect(container.textContent).toBe('')
  })
  it('lays the same facts out as rows in the block variant', () => {
    renderWithQuery(<GitStatusLine git={collected()} variant="block" />, 'en')
    expect(screen.getByText('Working tree')).toBeInTheDocument()
    expect(screen.getByText('2 staged')).toBeInTheDocument()
    expect(screen.getByText('origin/feature/59')).toBeInTheDocument()
    expect(screen.getByText('/srv/dev/alpha')).toBeInTheDocument()
  })
})
