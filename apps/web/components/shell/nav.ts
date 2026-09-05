import type { ComponentType } from 'react'
import {
  Activity,
  Boxes,
  Container,
  Globe,
  LayoutDashboard,
  ListTodo,
  Network,
  PlugZap,
  Settings as SettingsIcon,
} from 'lucide-react'

export type NavLabelKey =
  | 'overview'
  | 'projects'
  | 'tasks'
  | 'services'
  | 'docker'
  | 'network'
  | 'access'
  | 'gateway'
  | 'settings'

export type NavGroupKey = 'groups.development' | 'groups.infrastructure'

export interface NavItem {
  href: string
  labelKey: NavLabelKey
  icon: ComponentType<{ className?: string }>
  /**
   * Whether the page exists yet.
   *
   * The pages come back one group at a time as they are ported. An entry that
   * is not ready stays in this list rather than being deleted and re-added: the
   * order, the grouping and the icons are decided once, and turning a page on
   * is a one-word change beside it.
   */
  enabled: boolean
  /**
   * What somebody needs to hold for this entry to be theirs.
   *
   * Absent means everybody who reached the panel at all. The page refuses on
   * its own regardless; this is what keeps the rail from listing a page that
   * would answer 404 to the person reading it.
   */
  permission?: string
}

export interface NavGroup {
  /** Null for the trailing items that belong to no group. */
  labelKey: NavGroupKey | null
  items: NavItem[]
}

/**
 * Two groups and a tail. Development is where a day starts; infrastructure
 * is the set of technical perspectives over the same host. Settings sits
 * alone at the end because it is neither.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'groups.development',
    items: [
      { href: '/overview', labelKey: 'overview', icon: LayoutDashboard, enabled: true },
      { href: '/projects', labelKey: 'projects', icon: Boxes, enabled: true, permission: 'project:read' },
      { href: '/tasks', labelKey: 'tasks', icon: ListTodo, enabled: true, permission: 'task:read' },
    ],
  },
  {
    labelKey: 'groups.infrastructure',
    items: [
      { href: '/services', labelKey: 'services', icon: Container, enabled: true, permission: 'service:read' },
      { href: '/docker', labelKey: 'docker', icon: Activity, enabled: true, permission: 'docker:read' },
      { href: '/network', labelKey: 'network', icon: Network, enabled: true, permission: 'gateway:read' },
      { href: '/access', labelKey: 'access', icon: PlugZap, enabled: true, permission: 'access:read' },
      { href: '/gateway', labelKey: 'gateway', icon: Globe, enabled: true, permission: 'gateway:read' },
    ],
  },
  {
    labelKey: null,
    // No permission on the entry: Settings is a place with sections, and every
    // role holds at least one of them (`token:read` if nothing else). Which
    // section somebody lands on is decided by `/settings` itself.
    items: [{ href: '/settings', labelKey: 'settings', icon: SettingsIcon, enabled: true }],
  },
]

/** Which sidebar entry a path belongs to. `/projects/x/tasks` is still Projects. */
export function activeHref(pathname: string): string {
  const first = pathname.split('/').filter(Boolean)[0] ?? 'overview'
  // An environment is reached from a Project, and belongs under it.
  return first === 'environments' ? '/projects' : `/${first}`
}
