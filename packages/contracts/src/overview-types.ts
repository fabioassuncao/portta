// The Development Dashboard and the Development Context: what is happening,
// and what an agent needs before it starts. Both are read models over the
// entities in types.ts, task-types.ts and service-types.ts.

import { z } from 'zod'
import { Diagnostic, InstructionFile, RepositoryGitSummary } from './types.ts'
import { Session, Task, TaskSummary } from './task-types.ts'
import { Service } from './service-types.ts'

const named = <T extends z.ZodType>(schema: T, ref: string): T => schema.meta({ ref }) as T
const unixSeconds = z.number().describe('Unix timestamp in seconds')

/**
 * The host's state in one word, and the readings behind it. Computed from the
 * metrics the collector already writes; `measured: false` means the collector
 * is off or the snapshot is old, and the level says nothing.
 */
export const HostPressure = named(
  z.object({
    level: z.enum(['normal', 'watch', 'pressured', 'critical']),
    measured: z.boolean(),
    reasons: z.array(z.object({
      resource: z.enum(['cpu', 'memory', 'swap', 'storage', 'gpu', 'temperature', 'load', 'battery']),
      level: z.enum(['watch', 'pressured', 'critical']),
      value: z.number().describe('A ratio for anything measured 0-1, else the raw reading'),
    }).strict()),
  }).strict(),
  'HostPressure',
)
export type HostPressure = z.infer<typeof HostPressure>

export const AttentionItem = named(
  z.object({
    kind: z.enum(['service-unhealthy', 'environment-degraded', 'diagnostic', 'host-pressure', 'task-conflict', 'task-blocked', 'session-stale']),
    severity: z.enum(['warn', 'fail']),
    summary: z.string(),
    project: z.string().nullable().describe('Project slug'),
    environment: z.string().nullable(),
    service: z.string().nullable(),
    taskId: z.string().nullable(),
    href: z.string().describe('Where in the panel to act on it'),
  }).strict(),
  'AttentionItem',
)
export type AttentionItem = z.infer<typeof AttentionItem>

export const ProjectPulse = named(
  z.object({
    slug: z.string(),
    name: z.string(),
    archived: z.boolean(),
    openTasks: z.number().int(),
    inProgressTasks: z.number().int(),
    blockedTasks: z.number().int(),
    activeSessions: z.number().int(),
    repositoryCount: z.number().int(),
    environmentCount: z.number().int(),
    runningEnvironments: z.number().int(),
    unhealthyServices: z.number().int(),
    health: z.enum(['ok', 'partial', 'unhealthy', 'idle']),
    lastCommit: z.object({ sha: z.string(), shortSha: z.string(), subject: z.string(), repository: z.string(), date: unixSeconds }).strict().nullable(),
    lastActivityAt: unixSeconds.nullable(),
    lastActivity: z.string().nullable(),
    resources: z.object({ cpuUtilisation: z.number().nullable(), memoryUsedBytes: z.number().nullable() }).strict().nullable(),
  }).strict(),
  'ProjectPulse',
)
export type ProjectPulse = z.infer<typeof ProjectPulse>

export const RecentCommit = named(
  z.object({
    sha: z.string(),
    shortSha: z.string(),
    subject: z.string(),
    author: z.string(),
    date: unixSeconds,
    url: z.string().nullable(),
    repository: z.object({ id: z.string(), name: z.string() }).strict(),
    project: z.string().describe('Project slug'),
  }).strict(),
  'RecentCommit',
)
export type RecentCommit = z.infer<typeof RecentCommit>

export const DirtyRepository = named(
  z.object({
    id: z.string(),
    name: z.string(),
    project: z.string(),
    branch: z.string().nullable(),
    changed: z.number().int(),
    ahead: z.number().int(),
    behind: z.number().int(),
  }).strict(),
  'DirtyRepository',
)
export type DirtyRepository = z.infer<typeof DirtyRepository>

export const DevelopmentOverview = named(
  z.object({
    generatedAt: unixSeconds,
    work: z.object({
      inProgress: z.array(TaskSummary),
      review: z.array(TaskSummary),
      blocked: z.array(TaskSummary),
      counts: z.object({ open: z.number().int(), inProgress: z.number().int(), review: z.number().int(), blocked: z.number().int(), done: z.number().int() }).strict(),
    }).strict(),
    sessions: z.array(Session).describe('Active sessions, most recent activity first'),
    attention: z.array(AttentionItem),
    projects: z.array(ProjectPulse),
    code: z.object({
      recentCommits: z.array(RecentCommit),
      dirtyRepositories: z.array(DirtyRepository),
    }).strict(),
    runtime: z.object({
      environmentsRunning: z.number().int(),
      environmentsTotal: z.number().int(),
      servicesRunning: z.number().int(),
      servicesUnhealthy: z.number().int(),
      routedUrls: z.number().int(),
    }).strict(),
    resources: z.object({
      host: z.object({
        cpuUtilisation: z.number().nullable(),
        memoryUsedPercent: z.number().nullable(),
        storageUsedPercent: z.number().nullable(),
        stale: z.boolean(),
        collectorActive: z.boolean(),
        pressure: HostPressure,
      }).strict().nullable(),
      topProjects: z.array(z.object({ slug: z.string().nullable(), name: z.string(), environment: z.string(), cpuUtilisation: z.number().nullable(), memoryUsedBytes: z.number().nullable() }).strict()),
    }).strict(),
    gateway: z.object({ up: z.boolean(), problems: z.array(Diagnostic) }).strict(),
  }).strict(),
  'DevelopmentOverview',
)
export type DevelopmentOverview = z.infer<typeof DevelopmentOverview>

export const ContextRepository = named(
  z.object({
    id: z.string(),
    name: z.string(),
    role: z.string().nullable(),
    path: z.string().nullable().describe('The git root on the host, when known'),
    remoteUrl: z.string().nullable(),
    git: RepositoryGitSummary.nullable(),
    instructions: z.array(InstructionFile),
    environments: z.array(z.string()),
  }).strict(),
  'ContextRepository',
)
export type ContextRepository = z.infer<typeof ContextRepository>

export const ContextEnvironment = named(
  z.object({
    name: z.string(),
    running: z.boolean(),
    repository: z.string().nullable().describe('Repository id it runs from'),
    branch: z.string().nullable(),
    services: z.array(Service),
    logsCommand: z.string(),
    startCommand: z.string(),
    stopCommand: z.string(),
  }).strict(),
  'ContextEnvironment',
)
export type ContextEnvironment = z.infer<typeof ContextEnvironment>

export const DevelopmentContext = named(
  z.object({
    generatedAt: unixSeconds,
    actor: z.string().nullable(),
    /** What the caller may do here, as `resource:action`. */
    permissions: z.array(z.string()),
    project: z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      path: z.string().nullable(),
    }).strict(),
    task: Task.nullable().describe('The task the caller is about to work on, when it named one'),
    work: z.object({ inProgress: z.array(TaskSummary), next: TaskSummary.nullable() }).strict(),
    repositories: z.array(ContextRepository),
    environments: z.array(ContextEnvironment),
    instructions: z.object({
      platform: z.string().describe('The rules of a shared development host, in Markdown'),
      project: z.string().nullable().describe("The project's description, as its own note to a worker"),
      repositories: z.array(z.object({ repository: z.string(), path: z.string(), audience: z.string(), content: z.string().nullable(), truncated: z.boolean() }).strict()),
      task: z.string().nullable().describe('The task description and notes, when a task was named'),
    }).strict(),
    commands: z.record(z.string(), z.string()).describe('The CLI verbs that matter here, ready to copy'),
  }).strict(),
  'DevelopmentContext',
)
export type DevelopmentContext = z.infer<typeof DevelopmentContext>

export const EnvironmentResources = named(
  z.object({
    environment: z.string(),
    project: z.string().nullable().describe('Project slug, when adopted'),
    cpuUtilisation: z.number().nullable(),
    memoryUsedBytes: z.number().nullable(),
    containerCount: z.number().int(),
    containers: z.array(z.object({
      id: z.string(), name: z.string(), service: z.string().nullable(),
      cpuUtilisation: z.number().nullable(), memoryUsedBytes: z.number().nullable(), memoryLimitBytes: z.number().nullable(),
    }).strict()),
  }).strict(),
  'EnvironmentResources',
)
export type EnvironmentResources = z.infer<typeof EnvironmentResources>

/** Host → Project → Environment → Service → Container, attributed through adoption. */
export const ProjectResources = named(
  z.object({
    project: z.string(),
    collectedAt: unixSeconds.nullable(),
    stale: z.boolean(),
    collectorActive: z.boolean(),
    cpuUtilisation: z.number().nullable(),
    memoryUsedBytes: z.number().nullable(),
    hostMemoryTotalBytes: z.number().nullable(),
    environments: z.array(EnvironmentResources),
  }).strict(),
  'ProjectResources',
)
export type ProjectResources = z.infer<typeof ProjectResources>
