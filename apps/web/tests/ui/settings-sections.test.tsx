import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { principal, renderWithQuery } from './render.tsx'
import { navigation } from './setup.ts'
import { SETTINGS_SECTIONS, visibleSections } from '@/components/settings/sections'
import { SettingsSections } from '@/components/settings/settings-sections'
import { LocalMode } from '@/components/settings/local-mode'

const OWNER = SETTINGS_SECTIONS.flatMap((section) => (section.permission ? [section.permission] : []))

describe('which Settings sections somebody has', () => {
  it('gives an owner every one of them', () => {
    const ids = visibleSections({ permissions: OWNER, signsPeopleIn: true }).map((section) => section.id)
    expect(ids).toEqual(['general', 'users', 'tokens', 'security', 'integrations', 'audit'])
  })

  it('leaves a developer their own tokens and their own account', () => {
    const ids = visibleSections({
      permissions: ['token:read', 'github:read', 'project:read'],
      signsPeopleIn: true,
    }).map((section) => section.id)
    expect(ids).toEqual(['tokens', 'security', 'integrations'])
  })

  it('hides everything about accounts when the panel signs nobody in', () => {
    const ids = visibleSections({ permissions: OWNER, signsPeopleIn: false }).map((section) => section.id)
    expect(ids).toEqual(['general', 'integrations'])
  })
})

describe('the Settings rail', () => {
  it('offers only the sections this person has, and marks the one they are on', () => {
    navigation.pathname = '/settings/tokens'
    renderWithQuery(
      <SettingsSections signsPeopleIn />,
      undefined,
      principal({ role: 'developer', permissions: ['token:read', 'github:read'] }),
    )
    expect(screen.getByRole('link', { name: 'API tokens' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Security' })).toHaveAttribute('href', '/settings/security')
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'General' })).toBeNull()
  })

  it('keeps a section selected while a page under it is open', () => {
    navigation.pathname = '/settings/general/traefik'
    renderWithQuery(<SettingsSections signsPeopleIn />, undefined, principal())
    expect(screen.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('a section that needs accounts, in a panel that has none', () => {
  it('says the panel is local rather than showing an empty table', () => {
    renderWithQuery(<LocalMode section="users" />, undefined, principal())
    expect(screen.getByText('This panel does not sign people in')).toBeInTheDocument()
    expect(screen.getByText(/PORTTA_AUTH_MODE=protected/)).toBeInTheDocument()
  })
})
