import { describe, expect, it, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  TOOL_NAMES,
  createCaller,
  describeFailure,
  isLoopbackUrl,
  panelHeaders,
  registerTools,
  resolvePanelUrl,
} from './mcp.ts'
import { RefusedError } from '../errors.js'

describe('where the panel is', () => {
  it('defaults to the local panel on its configured port', () => {
    expect(resolvePanelUrl({}, {}, '8081')).toBe('http://127.0.0.1:8081')
    expect(resolvePanelUrl({ PORTTA_WEB_PORT: '9000' }, {}, '9000')).toBe('http://127.0.0.1:9000')
  })

  it('takes an explicit URL, and PORTTA_PANEL_URL, and trims a trailing slash', () => {
    expect(resolvePanelUrl({}, { url: 'http://localhost:8081/' }, '8081')).toBe('http://localhost:8081')
    expect(resolvePanelUrl({ PORTTA_PANEL_URL: 'http://[::1]:8081' }, {}, '8081')).toBe('http://[::1]:8081')
  })

  // The failure worth designing for is a misconfigured URL sending a panel
  // credential somewhere unintended.
  it('refuses a non-loopback panel without an explicit flag', () => {
    expect(() => resolvePanelUrl({}, { url: 'https://panel.example.com' }, '8081')).toThrow(RefusedError)
    expect(() => resolvePanelUrl({}, { url: 'https://panel.example.com' }, '8081'))
      .toThrowError(/refusing to send a panel credential/)
    expect(resolvePanelUrl({}, { url: 'https://panel.example.com', allowRemote: true }, '8081'))
      .toBe('https://panel.example.com')
  })

  it('refuses a URL it cannot even parse rather than assuming it is local', () => {
    expect(() => resolvePanelUrl({}, { url: 'not a url' }, '8081')).toThrow(RefusedError)
  })

  it('knows loopback from everything else', () => {
    for (const url of ['http://127.0.0.1:8081', 'http://localhost:1', 'http://[::1]:8081']) {
      expect(isLoopbackUrl(url), url).toBe(true)
    }
    for (const url of ['http://10.0.0.1', 'https://example.com', 'http://127.0.0.1.evil.com', '']) {
      expect(isLoopbackUrl(url), url).toBe(false)
    }
  })
})

describe('panelHeaders', () => {
  it('sends the actor on every call', () => {
    expect(panelHeaders({}, 'claude')['X-Portta-Actor']).toBe('claude')
  })

  // A panel in `disabled` mode needs no credential, and sending one would be a
  // secret in a request that never needed it.
  it('sends a credential only when there is one', () => {
    expect(panelHeaders({}, 'a')['authorization']).toBeUndefined()
  })

  it('sends the Bearer token the environment names', () => {
    const headers = panelHeaders({ PORTTA_TOKEN: 'ptt_secret' }, 'codex')
    expect(headers['authorization']).toBe('Bearer ptt_secret')
    expect(headers['X-Portta-Source']).toBe('cli')
  })

  // The one for this invocation wins: `--token` is the most explicit thing a
  // person can say, and it must not be shadowed by a stale environment.
  it('prefers the token passed in over the environment', () => {
    expect(panelHeaders({ PORTTA_TOKEN: 'ptt_env' }, 'a', undefined, { token: 'ptt_flag' })['authorization'])
      .toBe('Bearer ptt_flag')
  })

  // The agent talks to the panel. The panel talks to GitHub. Nothing about the
  // App ever reaches this process, and a header named for one would mean it had.
  it('carries nothing that could be a GitHub credential', () => {
    const headers = panelHeaders({
      PORTTA_TOKEN: 'ptt_secret',
      GITHUB_APP_PRIVATE_KEY_FILE: '/app/state/github/app.pem',
      GITHUB_APP_WEBHOOK_SECRET: 'shhh',
    }, 'agent')
    const serialised = JSON.stringify(headers)
    expect(serialised).not.toContain('shhh')
    expect(serialised).not.toContain('app.pem')
    expect(serialised.toLowerCase()).not.toContain('github')
  })
})

describe('describeFailure', () => {
  // An agent needs to tell "you asked for something impossible" from "try
  // again later", or it retries the first and gives up on the second.
  it('says which kind of failure it was', () => {
    expect(describeFailure(400, 'nothing to change')).toMatch(/^refused:/)
    expect(describeFailure(403, 'read-only')).toMatch(/^not permitted:/)
    expect(describeFailure(404, 'no task')).toMatch(/^not found:/)
    expect(describeFailure(503, 'rate limit')).toMatch(/worth retrying/)
    expect(describeFailure(500, 'boom')).toContain('the panel answered 500')
  })

  it('says something even when the panel said nothing', () => {
    expect(describeFailure(500, '   ')).toContain('(no detail)')
  })
})

describe('the API caller', () => {
  it('prefixes /api and carries the headers', async () => {
    const fetchMock = vi.fn(async () => new Response('{"tasks":[]}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const call = createCaller('http://127.0.0.1:8081', { 'X-Portta-Actor': 'agent' })
    const result = await call('GET', '/projects/produto/tasks')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8081/api/projects/produto/tasks')
    expect((init.headers as Record<string, string>)['X-Portta-Actor']).toBe('agent')
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toBe('{"tasks":[]}')
    vi.unstubAllGlobals()
  })

  it('sends a body only when there is one', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const call = createCaller('http://127.0.0.1:8081', {})
    await call('GET', '/tasks/1')
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBeUndefined()
    await call('POST', '/tasks/1/status', { status: 'review' })
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body).toBe('{"status":"review"}')
    vi.unstubAllGlobals()
  })

  it('turns a failure into a readable tool error rather than throwing', async () => {
    vi.stubGlobal('fetch', async () => new Response('no task', { status: 404 }))
    const call = createCaller('http://127.0.0.1:8081', {})
    const result = await call('GET', '/tasks/nope')
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/^not found:/)
    vi.unstubAllGlobals()
  })

  // A panel that is not running is the most common thing an agent will hit,
  // and it must read as a normal answer rather than as a crashed server.
  it('reports an unreachable panel as a tool error, naming the URL', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED') })
    const call = createCaller('http://127.0.0.1:8081', {})
    const result = await call('GET', '/tasks/1')
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('http://127.0.0.1:8081')
    expect(result.content[0]?.text).toContain('ECONNREFUSED')
    vi.unstubAllGlobals()
  })
})

describe('the tools', () => {
  function harness() {
    const calls: Array<[string, string, unknown]> = []
    const server = new McpServer({ name: 'test', version: '0' })
    registerTools(server, async (method, path, body) => {
      calls.push([method, path, body])
      return { content: [{ type: 'text', text: '{}' }] }
    })
    return { server, calls }
  }

  it('registers exactly the documented tools', () => {
    const { server } = harness()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registered = Object.keys((server as any)._registeredTools ?? {})
    expect(registered.sort()).toEqual([...TOOL_NAMES].sort())
  })

  // A tool that composes two calls is a workflow, and a workflow belongs in the
  // API where it can be tested without a transport.
  it('makes exactly one API call per tool', async () => {
    const { server, calls } = harness()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = (server as any)._registeredTools as Record<string, { handler: (args: unknown) => Promise<unknown> }>
    const args: Record<string, unknown> = {
      list_projects: {}, get_project: { project: 'produto' }, get_context: { project: 'produto', task: '7' },
      list_repositories: { project: 'produto' }, get_repository_git: { repository: '10' },
      list_environments: { all: true }, get_environment: { environment: 'alpha' }, list_services: { environment: 'alpha' },
      get_logs: { environment: 'alpha', service: 'api', tail: 50 }, get_resources: { project: 'produto' }, list_activity: { project: 'produto' },
      list_tasks: { project: 'produto' }, next_task: { project: 'produto' },
      get_task: { task: 'acme/api#1' }, get_subtasks: { task: 'acme/api#1' },
      create_task: { project: 'produto', title: 'x' }, start_task: { task: 'acme/api#1' },
      set_task_status: { task: 'acme/api#1', status: 'review' }, add_task_note: { task: '1', body: 'found it' },
      update_task: { task: '1', priority: 'high' }, comment_task: { task: 'acme/api#1', body: 'on it' },
      create_subtask: { task: '1', title: 'child' }, link_subtask: { task: '1', child: '2' },
      finish_task: { task: 'acme/api#1' }, link_task: { task: '1', issue: 'acme/api#1', initialSync: 'pull' },
      start_session: { project: 'produto', taskId: '1' }, end_session: { session: '9' },
      start_environment: { environment: 'alpha' }, stop_environment: { environment: 'alpha' }, restart_service: { environment: 'alpha', service: 'api' },
    }
    for (const name of TOOL_NAMES) {
      calls.length = 0
      await tools[name]!.handler(args[name])
      expect(calls, name).toHaveLength(1)
    }
  })

  // `owner/repo#number` has to survive a path segment: `#` would otherwise
  // truncate the URL at the fragment.
  it('encodes a coordinate reference into the path', async () => {
    const { server, calls } = harness()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = (server as any)._registeredTools as Record<string, { handler: (args: unknown) => Promise<unknown> }>
    await tools['get_task']!.handler({ task: 'acme/api#42' })
    expect(calls[0]?.[1]).toBe('/tasks/acme%2Fapi%2342')
    expect(calls[0]?.[1]).not.toContain('#')
  })

  it('omits an optional flag rather than guessing at it', async () => {
    const { server, calls } = harness()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = (server as any)._registeredTools as Record<string, { handler: (args: unknown) => Promise<unknown> }>
    await tools['start_task']!.handler({ task: 'x' })
    expect(calls[0]?.[2]).toEqual({})
    await tools['start_task']!.handler({ task: 'x', assign: false })
    expect(calls[1]?.[2]).toEqual({ assign: false })
  })
})
