import { afterEach, describe, expect, it, vi } from 'vitest'
import { panelLoopbackApiUrl, requestPanelMigrate, waitForPanelLoopback, webUrl } from './web.js'

type Context = Parameters<typeof webUrl>[0]

function context(config: Partial<Context['config']>, env: Record<string, string> = {}): Context {
  return {
    root: '/srv/portta',
    env,
    composeFiles: [],
    version: '0.2.0',
    config: {
      webExpose: 'local',
      webPort: 8081,
      webDev: false,
      tlsEnabled: false,
      domain: 'localhost',
      ...config,
    },
  } as unknown as Context
}

describe('where migrations reach the panel', () => {
  it('dials the published API port, never Vite', () => {
    expect(panelLoopbackApiUrl(context({ webDev: true }))).toBe('http://127.0.0.1:8081')
  })

  it('does not treat 0.0.0.0 as a dial address', () => {
    expect(panelLoopbackApiUrl(context({}, { PORTTA_WEB_BIND_ADDRESS: '0.0.0.0' }))).toBe(
      'http://127.0.0.1:8081',
    )
  })
})

describe('where the panel answers', () => {
  it('is the server port in production', () => {
    expect(webUrl(context({}))).toBe('http://127.0.0.1:8081')
  })

  // The panel is one process and HMR arrives on the port the API answers on.
  // There used to be a Vite container on 5173 in front of it, and reporting
  // that port now sends people to a door that is not there.
  it('is the same port in development', () => {
    expect(webUrl(context({ webDev: true }))).toBe('http://127.0.0.1:8081')
  })

  it('honours the bind address in both modes', () => {
    const env = { PORTTA_WEB_BIND_ADDRESS: '100.64.0.2' }
    expect(webUrl(context({}, env))).toBe('http://100.64.0.2:8081')
    expect(webUrl(context({ webDev: true }, env))).toBe('http://100.64.0.2:8081')
  })

  it('is the routed hostname when the panel is exposed over the VPN', () => {
    expect(webUrl(context({ webExpose: 'vpn', tlsEnabled: true }))).toBe(
      'https://portta-web.localhost',
    )
  })
})

describe('waiting for the panel before migrate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs migrate only after /api/health answers', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`)
      if (String(url).endsWith('/api/health')) return new Response('{"ok":true}', { status: 200 })
      if (String(url).endsWith('/api/database/migrate')) {
        return new Response(JSON.stringify({ applied: [], migrations: ['0000_initial'] }), { status: 200 })
      }
      throw new Error(`unexpected ${url}`)
    })

    await expect(requestPanelMigrate(context({}))).resolves.toEqual({ applied: [], migrations: ['0000_initial'] })
    expect(seen[0]).toBe('GET http://127.0.0.1:8081/api/health')
    expect(seen[1]).toBe('POST http://127.0.0.1:8081/api/database/migrate')
  })

  it('times out instead of hanging when the panel never answers', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED')
    })
    await expect(waitForPanelLoopback(context({}), 0)).rejects.toThrow(/the panel is not reachable/)
  })
})
