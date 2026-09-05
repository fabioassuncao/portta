// Who is asking, and what they may do.
//
// The panel has exactly one answer to both questions, and it is this package.
// `packages/server` decides what a route needs; this decides whether the person
// asking has it.

export {
  ac,
  AGENT_DEFAULT_PERMISSIONS,
  CAPABILITY_TO_PERMISSION,
  fromStatements,
  isPermission,
  PERMISSIONS,
  permissionsOf,
  READ_PERMISSIONS,
  ROLES,
  roles,
  statements,
  toStatements,
  type Permission,
  type Resource,
  type Role,
} from './access-control.ts'

export {
  authorize,
  can,
  Forbidden,
  refusalForBan,
  refusalForRemoval,
  refusalForRoleChange,
  refusalForTransfer,
  refusalForUserWrite,
  sees,
  Unauthenticated,
  type Principal,
  type PrincipalKind,
  type Scope,
  type UserSubject,
} from './authorize.ts'

export {
  ConfigError,
  resolveSecurityMode,
  trustedOrigins,
  useSecureCookies,
  type SecurityConfig,
  type SecurityMode,
} from './security-mode.ts'

export { createAuth, type Auth, type AuthDeps } from './auth.ts'
export {
  createPrincipalResolver,
  LOCAL_PRINCIPAL_NAME,
  principalFor,
  type PrincipalResolver,
  type ResolverDeps,
} from './principal.ts'
export {
  bootstrapOwner,
  hasOwner,
  SetupClosed,
  setupStatus,
  type BootstrapInput,
  type SetupStatus,
} from './bootstrap.ts'

export {
  collectTokens,
  createToken,
  findToken,
  listTokens,
  revokeToken,
  scopesFor,
  TOKEN_PREFIX,
  TokenRefused,
  type CreateTokenInput,
  type TokenDeps,
  type TokenRecord,
} from './api-tokens.ts'
