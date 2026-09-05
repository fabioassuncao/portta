// The six things Settings is.
//
// One list, read by the side navigation and by the redirect that picks a
// landing section, so the two can never disagree about what somebody has. A
// section nobody can open is not shown and not redirected to.

export interface SettingsSection {
  id: 'general' | 'users' | 'tokens' | 'security' | 'integrations' | 'audit'
  href: string
  /** What somebody must hold. Absent means anybody who reached the panel. */
  permission?: string
  /**
   * Whether this section exists at all in `open` mode.
   *
   * A panel that does not sign people in has no accounts, no tokens, no second
   * factor and nothing to audit. Showing them empty would say the feature is
   * broken rather than absent.
   */
  needsAccounts?: boolean
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'general', href: '/settings/general', permission: 'settings:read' },
  { id: 'users', href: '/settings/users', permission: 'user:list', needsAccounts: true },
  { id: 'tokens', href: '/settings/tokens', permission: 'token:read', needsAccounts: true },
  { id: 'security', href: '/settings/security', needsAccounts: true },
  { id: 'integrations', href: '/settings/integrations', permission: 'github:read' },
  { id: 'audit', href: '/settings/audit', permission: 'audit:read', needsAccounts: true },
]

export function visibleSections(options: {
  permissions: readonly string[]
  signsPeopleIn: boolean
}): SettingsSection[] {
  const held = new Set(options.permissions)
  return SETTINGS_SECTIONS.filter((section) =>
    (!section.needsAccounts || options.signsPeopleIn) &&
    (!section.permission || held.has(section.permission)))
}
