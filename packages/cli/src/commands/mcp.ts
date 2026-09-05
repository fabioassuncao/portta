// `portta mcp`: the task verbs, spoken to an agent over stdio.
//
// A thin adapter and nothing more. Every tool is one call to one endpoint; no
// tool composes two, because a workflow that needs composing composes in the
// API, where it can be tested without a transport. If a tool here ever grows a
// second request, that is the signal to add a verb to the API instead.
//
// It lives in the CLI rather than the panel for two reasons. The panel's
// dependency budget (ADR 0018 §9) exists because the panel may be reachable
// over a VPN, and this needs a large SDK; and `docs/monorepo.md` puts anything
// that holds no persistent decision outside the API. An MCP server holds no
// state and needs no database.
//
// **The agent never holds a GitHub credential.** It gets stdio to this process;
// this process gets a panel URL and, when the panel is authenticated, a panel
// credential. The GitHub private key stays a file the panel mounts read-only,
// and an installation token lives for an hour in the panel's memory.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { Command } from 'commander'
import { PanelClient, describeFailure, isLoopbackUrl, panelHeaders, resolvePanelUrl, type HttpMethod } from '../api.js'
import { gatewayContext } from '../context.js'
import { PreconditionError } from '../errors.js'
import { CLI_VERSION } from '../version.js'

function globals(command: Command) { return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string } }

export { describeFailure, isLoopbackUrl, panelHeaders, resolvePanelUrl }

/**
 * The shape every tool answers with. Widened to the SDK's own result type at
 * the registration boundary rather than in every handler, so the handlers stay
 * readable and one cast carries the whole adapter.
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

type SdkToolResult = Awaited<ReturnType<Parameters<McpServer['registerTool']>[2]>>
const asSdkResult = (result: Promise<ToolResult>) => result as Promise<SdkToolResult>

export interface ApiCaller {
  (method: HttpMethod, path: string, body?: unknown): Promise<ToolResult>
}

export function createCaller(url: string, headers: Record<string, string>, timeoutMs = 15_000): ApiCaller {
  const client = new PanelClient(url, headers, timeoutMs)
  return async (method, path, body) => {
    let answer
    try {
      answer = await client.answer(method, path, body)
    } catch (error) {
      return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }
    }
    if (!answer.ok) {
      return { content: [{ type: 'text', text: describeFailure(answer.status, answer.text) }], isError: true }
    }
    return { content: [{ type: 'text', text: answer.text }] }
  }
}

/** `owner/repo#number` and a slug both have to survive a path segment. */
function ref(value: string): string {
  return encodeURIComponent(value)
}

function search(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value))
  const text = query.toString()
  return text === '' ? '' : `?${text}`
}

const REF = z.string().min(1).describe('The task: its id, `#id`, or `owner/repo#number` through its GitHub binding.')
const PROJECT = z.string().min(1).describe('The Project slug.')
const STATUS = z.enum(['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done'])

/**
 * One tool per endpoint, named for what an agent asks. Registered here so the
 * list can be asserted without starting a transport.
 */
export function registerTools(server: McpServer, call: ApiCaller): void {
  // --- read: projects, repositories, environments, services, logs, resources
  server.registerTool('list_projects', {
    title: 'List Projects',
    description: 'Every Project on this Node with its repositories, tasks, environments and health, in one answer.',
    inputSchema: {},
  }, async () => asSdkResult(call('GET', '/projects')))

  server.registerTool('get_project', {
    title: 'Get one Project',
    description: 'Repositories with their git state, environments with their services, and the counts that matter.',
    inputSchema: { project: PROJECT },
  }, async ({ project }) => asSdkResult(call('GET', `/projects/${ref(project)}`)))

  server.registerTool('get_context', {
    title: 'The Development Context of a Project',
    description: 'What to read before working: the Project, its repositories and branches, the task (when given), the environments and how to reach them, and the instruction files that apply.',
    inputSchema: { project: PROJECT, task: REF.optional() },
  }, async ({ project, task }) => asSdkResult(call('GET', `/projects/${ref(project)}/context${search({ task })}`)))

  server.registerTool('list_repositories', {
    title: "A Project's repositories",
    inputSchema: { project: PROJECT },
  }, async ({ project }) => asSdkResult(call('GET', `/projects/${ref(project)}/repositories`)))

  server.registerTool('get_repository_git', {
    title: 'Git state of a repository',
    description: 'Branch, HEAD, dirty counts, ahead/behind, the last commits and the instruction files, as the host collected them.',
    inputSchema: { repository: z.string().min(1).describe('The repository id.') },
  }, async ({ repository }) => asSdkResult(call('GET', `/repositories/${ref(repository)}/git`)))

  server.registerTool('list_environments', {
    title: 'Environments running on this Node',
    inputSchema: { all: z.boolean().optional().describe('Include environments with nothing on the gateway.') },
  }, async ({ all }) => asSdkResult(call('GET', `/environments${search({ all })}`)))

  server.registerTool('get_environment', {
    title: 'One environment',
    description: 'Its services, URLs, health, the task it runs for, and whether it can be operated.',
    inputSchema: { environment: z.string().min(1).describe('COMPOSE_PROJECT_NAME') },
  }, async ({ environment }) => asSdkResult(call('GET', `/environments/${ref(environment)}`)))

  server.registerTool('list_services', {
    title: "An environment's services",
    description: 'State, health, endpoints, resources and container per service.',
    inputSchema: { environment: z.string().min(1) },
  }, async ({ environment }) => asSdkResult(call('GET', `/environments/${ref(environment)}/services`)))

  server.registerTool('get_logs', {
    title: 'Logs of an environment, or of one service in it',
    inputSchema: { environment: z.string().min(1), service: z.string().optional(), tail: z.number().int().min(1).max(2000).optional() },
  }, async ({ environment, service, tail }) => asSdkResult(call('GET', `/environments/${ref(environment)}/logs${search({ service, tail })}`)))

  server.registerTool('get_resources', {
    title: 'Host resources, by Project',
    description: 'CPU, memory and storage of this machine, and which Project consumes what.',
    inputSchema: { project: PROJECT.optional() },
  }, async ({ project }) => asSdkResult(call('GET', project ? `/projects/${ref(project)}/resources` : '/metrics/current')))

  server.registerTool('list_activity', {
    title: 'What happened',
    description: 'Tasks moved, sessions started and ended, commits landed, environments started and stopped. Newest first.',
    inputSchema: { project: PROJECT.optional(), kind: z.string().optional().describe('Comma-separated event kinds.'), limit: z.number().int().min(1).max(500).optional() },
  }, async ({ project, kind, limit }) => asSdkResult(call('GET', `${project ? `/projects/${ref(project)}/activity` : '/activity'}${search({ kind, limit })}`)))

  // --- tasks
  server.registerTool('list_tasks', {
    title: 'List tasks',
    description: "A Project's tasks. Local-first: they exist with or without GitHub; a bound issue is shown on the task.",
    inputSchema: { project: PROJECT, status: z.string().optional().describe('Comma-separated statuses.'), open: z.boolean().optional() },
  }, async ({ project, status, open }) => asSdkResult(call('GET', `/projects/${ref(project)}/tasks${search({ status, open })}`)))

  server.registerTool('next_task', {
    title: 'The task to do next',
    description: 'The highest-priority ready task that is unblocked by its subtasks and not assigned to somebody else. Returns null when there is nothing to do, which is an answer rather than an error.',
    inputSchema: { project: PROJECT },
  }, async ({ project }) => asSdkResult(call('GET', `/projects/${ref(project)}/tasks/next`)))

  server.registerTool('get_task', {
    title: 'Get one task',
    description: 'With its description, notes, subtasks, environments and GitHub binding.',
    inputSchema: { task: REF },
  }, async ({ task }) => asSdkResult(call('GET', `/tasks/${ref(task)}`)))

  server.registerTool('get_subtasks', {
    title: 'The subtask tree under a task',
    inputSchema: { task: REF },
  }, async ({ task }) => asSdkResult(call('GET', `/tasks/${ref(task)}/subtasks`)))

  server.registerTool('create_task', {
    title: 'Create a task',
    description: 'Local, immediately. Give parentId to make it a subtask.',
    inputSchema: {
      project: PROJECT, title: z.string().min(1), description: z.string().optional(), status: STATUS.optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(), parentId: z.string().optional(), repositoryId: z.string().optional(),
      environment: z.string().optional(), labels: z.array(z.string()).optional(),
    },
  }, async ({ project, ...body }) => asSdkResult(call('POST', `/projects/${ref(project)}/tasks`, body)))

  server.registerTool('start_task', {
    title: 'Take a task',
    description: 'Moves it to in_progress and assigns you, in one write, so a task is never half-taken.',
    inputSchema: { task: REF, assign: z.boolean().optional().describe('Assign the actor. Default true.') },
  }, async ({ task, assign }) => asSdkResult(call('POST', `/tasks/${ref(task)}/start`, assign === undefined ? {} : { assign })))

  server.registerTool('set_task_status', {
    title: 'Move a task to one status',
    inputSchema: { task: REF, status: STATUS },
  }, async ({ task, status }) => asSdkResult(call('POST', `/tasks/${ref(task)}/move`, { status })))

  server.registerTool('update_task', {
    title: 'Partially update one task',
    description: 'Only supplied fields change; concurrent clients do not overwrite the rest of the task.',
    inputSchema: { task: REF, title: z.string().min(1).optional(), description: z.string().nullable().optional(), status: STATUS.optional(), priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable().optional(), assignee: z.string().nullable().optional(), agent: z.string().nullable().optional(), labels: z.array(z.string()).optional() },
  }, async ({ task, ...patch }) => asSdkResult(call('PATCH', `/tasks/${ref(task)}`, patch)))

  server.registerTool('add_task_note', {
    title: 'Add a note to a task',
    description: 'Local; never reaches GitHub. Use it to leave what you found, what you did, and what is left.',
    inputSchema: { task: REF, body: z.string().min(1) },
  }, async ({ task, body }) => asSdkResult(call('POST', `/tasks/${ref(task)}/notes`, { body })))

  server.registerTool('comment_task', {
    title: 'Add a local Markdown comment',
    description: 'Always persists in Portta. Publishing a copy to a bound GitHub issue is a separate explicit API operation.',
    inputSchema: { task: REF, body: z.string().min(1).describe('GitHub Flavored Markdown.') },
  }, async ({ task, body }) => asSdkResult(call('POST', `/tasks/${ref(task)}/comments`, { body })))

  server.registerTool('create_subtask', {
    title: 'Create a subtask',
    inputSchema: { task: REF, title: z.string().min(1), status: STATUS.optional(), repositoryId: z.string().optional() },
  }, async ({ task, ...body }) => asSdkResult(call('POST', `/tasks/${ref(task)}/subtasks`, body)))

  server.registerTool('link_subtask', {
    title: 'Link an existing task as a subtask',
    inputSchema: { task: REF, child: REF },
  }, async ({ task, child }) => asSdkResult(call('PUT', `/tasks/${ref(task)}/subtasks/${ref(child)}`, {})))

  server.registerTool('finish_task', {
    title: 'Finish a task',
    description: 'Moves it to done and, when close is true, closes the bound issue.',
    inputSchema: { task: REF, close: z.boolean().optional().describe('Close the issue as well. Default false.') },
  }, async ({ task, close }) => asSdkResult(call('POST', `/tasks/${ref(task)}/finish`, close === undefined ? {} : { close })))

  server.registerTool('link_task', {
    title: 'Bind a task to a projected GitHub issue',
    inputSchema: { task: REF, issue: z.string().min(3).describe('owner/repo#number'), initialSync: z.enum(['pull', 'push']).describe('Import GitHub fields, or publish Portta fields.') },
  }, async ({ task, issue, initialSync }) => asSdkResult(call('POST', `/tasks/${ref(task)}/github/link`, { issue, initialSync })))

  // --- sessions
  server.registerTool('start_session', {
    title: 'Say that you are working',
    description: 'Start a development session on a Project, optionally on a task, a repository and an environment. End it with end_session.',
    inputSchema: { project: PROJECT, taskId: z.string().optional(), repositoryId: z.string().optional(), environment: z.string().optional(), summary: z.string().optional() },
  }, async ({ project, ...body }) => asSdkResult(call('POST', `/projects/${ref(project)}/sessions`, body)))

  server.registerTool('end_session', {
    title: 'Say that you are done',
    inputSchema: { session: z.string().min(1), summary: z.string().optional() },
  }, async ({ session, summary }) => asSdkResult(call('PATCH', `/sessions/${ref(session)}`, { status: 'ended', ...(summary === undefined ? {} : { summary }) })))

  // --- operate (gated by capability on the panel, not here)
  server.registerTool('start_environment', {
    title: 'Start an environment',
    inputSchema: { environment: z.string().min(1) },
  }, async ({ environment }) => asSdkResult(call('POST', `/environments/${ref(environment)}/actions/start`)))

  server.registerTool('stop_environment', {
    title: 'Stop an environment',
    inputSchema: { environment: z.string().min(1) },
  }, async ({ environment }) => asSdkResult(call('POST', `/environments/${ref(environment)}/actions/stop`)))

  server.registerTool('restart_service', {
    title: 'Restart one service of an environment',
    inputSchema: { environment: z.string().min(1), service: z.string().min(1) },
  }, async ({ environment, service }) => asSdkResult(call('POST', `/environments/${ref(environment)}/services/${ref(service)}/actions/restart`)))
}

/** The tool names, in the order they are registered. Asserted by a test. */
export const TOOL_NAMES = [
  'list_projects', 'get_project', 'get_context', 'list_repositories', 'get_repository_git',
  'list_environments', 'get_environment', 'list_services', 'get_logs', 'get_resources', 'list_activity',
  'list_tasks', 'next_task', 'get_task', 'get_subtasks', 'create_task', 'start_task', 'set_task_status',
  'update_task', 'add_task_note', 'comment_task', 'create_subtask', 'link_subtask', 'finish_task', 'link_task',
  'start_session', 'end_session',
  'start_environment', 'stop_environment', 'restart_service',
] as const

export interface McpOptions {
  url?: string
  allowRemote?: boolean
  actor?: string
}

export async function mcpCommand(options: McpOptions, command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile, required: false })
  const url = resolvePanelUrl(context.env, options, context.env['PORTTA_WEB_PORT'] ?? '8081')
  const actor = options.actor ?? context.env['PORTTA_MCP_ACTOR'] ?? 'agent'

  // stdout is the transport. Anything written there that is not a protocol
  // message corrupts the session, which is why nothing in this command prints.
  const server = new McpServer({ name: 'portta', version: CLI_VERSION })
  // The same credential resolution as every other command: `PORTTA_TOKEN`, or
  // whatever `portta auth login` saved for this panel. An agent configured once
  // keeps working after a token rotation without its config being edited.
  // Explicitly an agent: this is the surface agents drive, and what it may do
  // is the `agentPermissions` ceiling rather than whatever the operator holds.
  registerTools(server, createCaller(url, panelHeaders(context.env, actor, 'agent', { url })))

  try {
    await server.connect(new StdioServerTransport())
  } catch (error) {
    throw new PreconditionError(
      `the MCP transport could not start: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
