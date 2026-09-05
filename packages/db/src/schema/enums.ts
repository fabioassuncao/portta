// The vocabularies the database enforces.
//
// Every one of them is built from a constant in portta-core, which is where the
// CLI, the contract and the panel already read it. A value exists once: adding
// a task status means editing one array and generating a migration, never
// editing a list in four places and discovering the fifth in production.
//
// What is *not* here is deliberate. A repository's `role` and a task's `type`
// stay free text with a documented vocabulary, because adding one should not be
// a migration.

import {
  ACTIVITY_SOURCES,
  ACTOR_KINDS,
  ROLES,
  SESSION_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_SYNC_STATES,
} from 'portta-core'
import { pgEnum } from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', ROLES)
export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES)
export const taskPriorityEnum = pgEnum('task_priority', TASK_PRIORITIES)
export const taskSyncStateEnum = pgEnum('task_sync_state', TASK_SYNC_STATES)
export const sessionStatusEnum = pgEnum('session_status', SESSION_STATUSES)
export const activitySourceEnum = pgEnum('activity_source', ACTIVITY_SOURCES)

/** Who acted. `system` is the panel itself: a timer, a webhook, a migration. */
export const actorKindEnum = pgEnum('actor_kind', ACTOR_KINDS)

/**
 * A session or an attachment is always a person or an agent — never the panel —
 * so the two places that mean exactly that use their own narrower vocabulary
 * rather than accepting `system` and refusing it in code.
 */
export const humanOrAgentEnum = pgEnum('human_or_agent', ['human', 'agent'])

/** Why an environment belongs to the project that adopted it. */
export const adoptionSourceEnum = pgEnum('adoption_source', ['manual', 'label', 'repo-match', 'path'])

/** Why an environment is linked to the task being worked on in it. */
export const taskEnvironmentSourceEnum = pgEnum('task_environment_source', [
  'manual',
  'label',
  'branch',
  'namespace',
])

/** Which forge a repository's remote belongs to. `local` when there is none. */
export const repositoryProviderEnum = pgEnum('repository_provider', [
  'local',
  'github',
  'gitlab',
  'bitbucket',
  'other',
])

/** Whether a note has been published to the issue the task is bound to. */
export const publishStateEnum = pgEnum('publish_state', ['local', 'pending', 'synced', 'error'])

/** GitHub's own issue vocabulary, projected. */
export const issueStateEnum = pgEnum('issue_state', ['open', 'closed'])

/**
 * Where an issue's status and priority came from. The panel says *this came
 * from a label, not from a field*, which changes what a write will do.
 */
export const metadataSourceEnum = pgEnum('metadata_source', ['fields', 'labels', 'none'])

/** How a principal proved who it was. */
export const principalKindEnum = pgEnum('principal_kind', ['local', 'user', 'token'])
