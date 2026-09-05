// What a role may do.
//
// One vocabulary, `resource:action`, used by every route, every token scope and
// every setting. The statements are the source: the flat permission names, the
// four roles and the agent default are all derived from them, so adding an
// action is one line here rather than five in five files.
//
// The `user` and `session` resources come from Better Auth's admin plugin: its
// endpoints authorise against exactly those, so they are spread in rather than
// restated. Everything else is Portta's.

import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/admin/access'
import { ROLES, type Role as RoleName } from 'portta-core'

export const statements = {
  ...defaultStatements,
  project: ['read', 'create', 'update', 'delete', 'members'],
  repository: ['read', 'manage'],
  task: ['read', 'write', 'delete', 'sync'],
  environment: ['read', 'operate', 'destroy', 'settings'],
  service: ['read', 'operate'],
  container: ['read', 'operate', 'destroy'],
  logs: ['read'],
  metrics: ['read'],
  activity: ['read'],
  worksession: ['read', 'write'],
  /** Bridges, forwarders and shares: the ways into a running environment. */
  access: ['read', 'open', 'manage'],
  gateway: ['read', 'operate'],
  docker: ['read', 'operate', 'destroy'],
  github: ['read', 'sync', 'manage'],
  settings: ['read', 'manage'],
  token: ['read', 'create', 'revoke'],
  audit: ['read'],
} as const

export const ac = createAccessControl(statements)

export type Statements = typeof statements
export type Resource = keyof Statements

/** `task:write` — the flat form every route, token scope and setting uses. */
export type Permission = {
  [R in Resource]: `${R & string}:${Statements[R][number]}`
}[Resource]

export type Role = RoleName
export { ROLES }

const everything = Object.fromEntries(
  Object.entries(statements).map(([resource, actions]) => [resource, [...actions]]),
) as Record<Resource, string[]>

/**
 * Impersonation is not a feature of this product.
 *
 * The admin plugin offers it; Portta does not, so no role holds it. A panel
 * that can start and stop containers should not also let one person act as
 * another without a trace.
 */
const withoutImpersonation = {
  ...everything,
  user: everything.user.filter((action) => action !== 'impersonate' && action !== 'impersonate-admins'),
}

export const owner = ac.newRole({ ...withoutImpersonation } as never)
/** The difference between `owner` and `admin` is a service rule, not a statement (03 §6.4). */
export const admin = ac.newRole({ ...withoutImpersonation } as never)

export const developer = ac.newRole({
  project: ['read'],
  repository: ['read', 'manage'],
  task: ['read', 'write', 'delete', 'sync'],
  environment: ['read', 'operate', 'settings'],
  service: ['read', 'operate'],
  container: ['read', 'operate'],
  logs: ['read'],
  metrics: ['read'],
  activity: ['read'],
  worksession: ['read', 'write'],
  access: ['read', 'open'],
  gateway: ['read'],
  github: ['read', 'sync'],
  token: ['read', 'create', 'revoke'],
} as never)

export const viewer = ac.newRole({
  project: ['read'],
  repository: ['read'],
  task: ['read'],
  environment: ['read'],
  service: ['read'],
  container: ['read'],
  logs: ['read'],
  metrics: ['read'],
  activity: ['read'],
  worksession: ['read'],
  access: ['read'],
  gateway: ['read'],
  github: ['read'],
  token: ['read', 'create', 'revoke'],
} as never)

export const roles = { owner, admin, developer, viewer } as const

function flatten(granted: Record<string, readonly string[] | undefined>): Permission[] {
  return Object.entries(granted).flatMap(([resource, actions]) =>
    (actions ?? []).map((action) => `${resource}:${action}` as Permission),
  )
}

/** Every permission this installation knows, in statement order. */
export const PERMISSIONS: readonly Permission[] = flatten(statements as never)

const BY_ROLE = new Map<Role, ReadonlySet<Permission>>(
  ROLES.map((role) => [role, new Set(flatten(roles[role].statements as never))]),
)

export function permissionsOf(role: Role): ReadonlySet<Permission> {
  return BY_ROLE.get(role) ?? new Set()
}

/** Everything that only reads. Read-only mode intersects with this. */
export const READ_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter((permission) =>
  permission.endsWith(':read'),
)

/**
 * What an agent holds unless the operator says otherwise.
 *
 * A developer's permissions minus the three that change how the panel itself
 * behaves: an agent works on tasks and environments, it does not reconfigure
 * an environment, re-register a repository or push a sync at GitHub.
 */
export const AGENT_DEFAULT_PERMISSIONS: readonly Permission[] = [...permissionsOf('developer')].filter(
  (permission) =>
    permission !== 'environment:settings' &&
    permission !== 'repository:manage' &&
    permission !== 'github:sync',
)

/**
 * The capability each route used to declare, and the permission it declares now.
 *
 * Kept as a table rather than applied and deleted, because it is the only place
 * that says what the rename meant — and because a route added while the two
 * vocabularies overlapped can still be checked against it.
 */
export const CAPABILITY_TO_PERMISSION = {
  'project:read': 'project:read',
  'project:write': 'project:update',
  'repository:read': 'repository:read',
  'repository:write': 'repository:manage',
  'task:read': 'task:read',
  'task:write': 'task:write',
  'task:sync': 'task:sync',
  'environment:read': 'environment:read',
  'environment:operate': 'environment:operate',
  'environment:destroy': 'environment:destroy',
  'service:read': 'service:read',
  'logs:read': 'logs:read',
  'metrics:read': 'metrics:read',
  'activity:read': 'activity:read',
  'access:open': 'access:open',
  'access:write': 'access:manage',
  'session:write': 'worksession:write',
  'gateway:read': 'gateway:read',
  'gateway:operate': 'gateway:operate',
  'config:read': 'settings:read',
  'config:write': 'settings:manage',
  'docker:read': 'docker:read',
  'docker:operate': 'docker:operate',
  'docker:destroy': 'docker:destroy',
  'github:read': 'github:read',
  'github:sync': 'github:sync',
} as const satisfies Record<string, Permission>

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value)
}

/**
 * `['task:read', 'task:write']` → `{ task: ['read', 'write'] }`.
 *
 * The apiKey plugin stores scopes in the nested form; every other surface in
 * Portta names them flat, because that is what a route declares and what an
 * operator reads in a list.
 */
export function toStatements(permissions: readonly Permission[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}
  for (const permission of permissions) {
    const [resource, action] = permission.split(':') as [string, string]
    ;(grouped[resource] ??= []).push(action)
  }
  return grouped
}

/** The inverse, for reading a token's stored scopes back. */
export function fromStatements(granted: Record<string, readonly string[]> | null | undefined): Permission[] {
  if (!granted) return []
  return flatten(granted).filter(isPermission)
}
