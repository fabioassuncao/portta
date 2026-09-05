import { describe, expect, it, vi } from 'vitest'
import { LiveHub, translate } from '../src/realtime/hub.ts'
import { createSnapshotCache } from '../src/services/inventory.ts'
import { fakeDocker, testConfig } from './helpers.ts'
import { FULL_HOST } from './fixtures.ts'

describe('translating Docker events', () => {
  it('forwards the container lifecycle', () => {
    const event = translate({
      Type: 'container',
      Action: 'start',
      Actor: { ID: 'abc', Attributes: { name: 'alpha-web-1', 'com.docker.compose.project': 'alpha' } },
      time: 1700,
    })
    expect(event).toMatchObject({ kind: 'container', action: 'start', name: 'alpha-web-1', project: 'alpha' })
  })

  it('recognises a health change', () => {
    const event = translate({
      Type: 'container',
      Action: 'health_status: unhealthy',
      Actor: { ID: 'abc', Attributes: { name: 'beta-web-1' } },
    })
    expect(event?.kind).toBe('health')
    expect(event?.action).toContain('unhealthy')
  })

  it('marks a bridge as its own kind, so the Access page can react', () => {
    const event = translate({
      Type: 'container',
      Action: 'destroy',
      Actor: {
        ID: 'abc',
        Attributes: { name: 'portta-access-alpha-postgres-x', 'portta.component': 'access-bridge' },
      },
    })
    expect(event?.kind).toBe('bridge')
    expect(event?.ownership).toBe('standalone')
  })

  it('knows a gateway container when it sees one', () => {
    const event = translate({
      Type: 'container',
      Action: 'restart',
      Actor: { ID: 'abc', Attributes: { name: 'traefik', 'portta.managed': 'true' } },
    })
    expect(event?.ownership).toBe('gateway')
  })

  it('forwards network changes', () => {
    expect(translate({ Type: 'network', Action: 'connect', Actor: { ID: 'n1' } })?.kind).toBe('network')
  })

  it('drops the noise nothing on screen depends on', () => {
    expect(translate({ Type: 'container', Action: 'exec_create: ls' })).toBeNull()
    expect(translate({ Type: 'image', Action: 'pull' })).toBeNull()
    expect(translate({ Type: 'volume', Action: 'create' })).toBeNull()
    expect(translate({})).toBeNull()
  })
})

describe('the live hub', () => {
  it('fans an event out to every subscriber', () => {
    const docker = fakeDocker({ containers: FULL_HOST })
    const config = testConfig()
    const cache = createSnapshotCache(docker.client, config)
    const hub = new LiveHub(docker.client, cache)

    const first = vi.fn()
    const second = vi.fn()
    const stop = hub.subscribe(first)
    hub.subscribe(second)

    hub.publish({
      kind: 'container',
      action: 'start',
      id: 'x',
      name: 'x',
      project: null,
      ownership: 'external',
      at: 1,
    })

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()

    stop()
    hub.publish({
      kind: 'container',
      action: 'stop',
      id: 'x',
      name: 'x',
      project: null,
      ownership: 'external',
      at: 2,
    })
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('keeps going when one browser goes away mid-write', () => {
    const docker = fakeDocker({ containers: [] })
    const config = testConfig()
    const hub = new LiveHub(docker.client, createSnapshotCache(docker.client, config))
    const healthy = vi.fn()
    hub.subscribe(() => {
      throw new Error('socket closed')
    })
    hub.subscribe(healthy)

    expect(() =>
      hub.publish({
        kind: 'container',
        action: 'die',
        id: 'x',
        name: 'x',
        project: null,
        ownership: 'external',
        at: 1,
      }),
    ).not.toThrow()
    expect(healthy).toHaveBeenCalledOnce()
  })
})

describe('GET /api/events', () => {
  it('opens an SSE stream and greets the client', async () => {
    const { makeApp } = await import('./helpers.ts')
    const { app } = makeApp({ containers: FULL_HOST })
    const response = await app.request('/api/events')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body?.getReader()
    const chunk = await reader?.read()
    expect(new TextDecoder().decode(chunk?.value)).toContain('event: hello')
    await reader?.cancel()
  })
})
