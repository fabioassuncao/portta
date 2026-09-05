// The Development Context: everything an agent (or a person on a new machine)
// needs to read before working on a project, in one answer.
//
// Pure over its inputs. The route gathers the catalog, the scans, the tasks
// and the services; this decides what goes in and in which words. The
// platform rules are the short version of docs/agent-guidelines.md, embedded
// so the answer is complete offline and needs no second request.

import type {
  ContextEnvironment,
  ContextRepository,
  DevelopmentContext,
  Environment,
  EnvironmentServices,
  Project,
  RepositoryGit,
  Task,
  TaskSummary,
} from 'portta-contracts'

export const PLATFORM_INSTRUCTIONS = `## Shared development host

Other environments are running on this machine. They belong to other people or
other agents, and you cannot tell which by looking.

Never:
- stop or remove a container, volume or network you did not create
- run \`docker system prune\` or any \`docker * prune\`
- change an internal port to resolve a conflict
- publish a database or cache on the host (no \`5432:5432\`, ever)
- reuse another environment's volume or namespace
- stop Portta to fix your own project

Always:
- set a unique \`COMPOSE_PROJECT_NAME\` (\`portta namespace\`)
- check ownership before touching a container:
  \`docker inspect <c> --format '{{ index .Config.Labels "com.docker.compose.project" }}'\`
- run \`portta doctor\` before improvising infrastructure
- report URLs from \`portta urls\`, not \`localhost:3000\`
- reach databases in this order: \`docker compose exec\`, then
  \`portta db psql\` / \`redis cli\`, then \`portta access open\` for a GUI,
  then \`portta remote access open\` over the VPN for a VPS. Never by
  publishing a port, and never on \`0.0.0.0\`
- stop only what you started, from its own directory

Work through Portta's own model:
- \`portta tasks next --project <slug>\` is the task to take; \`portta tasks start <id>\`
  takes it and \`portta tasks finish <id>\` hands it back for review
- \`portta sessions start --project <slug> --task <id>\` says you are working;
  end it when you stop, with a summary
- \`portta tasks note <id> "<text>"\` is how you leave a trace a person can read
- name the environment after the task (\`portta namespace --suffix task<id>\`,
  or a branch \`task-<id>-…\`) and the panel links them for you

If a port seems taken, that is the signal that something publishes a port it
does not need. Fix that; do not free the port by force.
`

export interface ContextInput {
  now: number
  actor: string | null
  permissions: readonly string[]
  project: Project
  task: Task | null
  inProgress: TaskSummary[]
  next: TaskSummary | null
  scans: Map<string, RepositoryGit>
  environments: Environment[]
  services: Map<string, EnvironmentServices>
}

export function contextRepositories(input: ContextInput): ContextRepository[] {
  return input.project.repositories.map((repository) => {
    const scan = repository.scanKey ? input.scans.get(repository.scanKey) : undefined
    return {
      id: repository.id,
      name: repository.name,
      role: repository.role,
      path: repository.scanPath ?? repository.localPath,
      remoteUrl: repository.remoteUrl,
      git: repository.git,
      instructions: scan?.instructions ?? [],
      environments: repository.environments,
    }
  })
}

export function contextEnvironments(input: ContextInput): ContextEnvironment[] {
  const repositoryOf = new Map<string, string>()
  for (const repository of input.project.repositories) for (const env of repository.environments) repositoryOf.set(env, repository.id)
  return input.environments.map((environment) => {
    const repositoryId = repositoryOf.get(environment.name) ?? null
    const repository = input.project.repositories.find((r) => r.id === repositoryId)
    return {
      name: environment.name,
      running: environment.runningCount > 0,
      repository: repositoryId,
      branch: repository?.git?.branch ?? null,
      services: input.services.get(environment.name)?.services ?? [],
      logsCommand: `portta envs logs ${environment.name}`,
      startCommand: `portta envs start ${environment.name}`,
      stopCommand: `portta envs stop ${environment.name}`,
    }
  })
}

export function buildContext(input: ContextInput): DevelopmentContext {
  const repositories = contextRepositories(input)
  const task = input.task
  const taskText = task
    ? [
        `# #${task.id} ${task.title}`,
        task.description ?? '',
        ...(task.subtasks.length > 0 ? ['', '## Subtasks', ...task.subtasks.map((s) => `- [${s.status === 'done' ? 'x' : ' '}] #${s.id} ${s.title}${s.repository ? ` (${s.repository.name})` : ''}`)] : []),
        ...(task.notes.length > 0 ? ['', '## Notes', ...task.notes.map((n) => `- ${n.actor ?? 'someone'}: ${n.body}`)] : []),
      ].join('\n').trim()
    : null
  const slug = input.project.slug
  return {
    generatedAt: Math.floor(input.now / 1000),
    actor: input.actor,
    permissions: [...input.permissions],
    project: {
      slug,
      name: input.project.name,
      description: input.project.description,
      path: input.project.resolvedPath,
    },
    task,
    work: { inProgress: input.inProgress, next: input.next },
    repositories,
    environments: contextEnvironments(input),
    instructions: {
      platform: PLATFORM_INSTRUCTIONS,
      project: input.project.description,
      repositories: repositories.flatMap((repository) =>
        repository.instructions.map((file) => ({ repository: repository.name, path: file.path, audience: file.audience, content: file.content, truncated: file.truncated }))),
      task: taskText,
    },
    commands: {
      context: `portta projects context ${slug}${task ? ` --task ${task.id}` : ''} --json`,
      nextTask: `portta tasks next --project ${slug}`,
      startTask: task ? `portta tasks start ${task.id}` : `portta tasks start <id>`,
      finishTask: task ? `portta tasks finish ${task.id}` : `portta tasks finish <id>`,
      note: task ? `portta tasks note ${task.id} "<text>"` : `portta tasks note <id> "<text>"`,
      startSession: `portta sessions start --project ${slug}${task ? ` --task ${task.id}` : ''}`,
      environments: `portta envs list --json`,
      repositories: `portta repos status --json`,
      doctor: 'portta doctor',
    },
  }
}
