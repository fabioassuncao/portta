import { describe, expect, it } from 'vitest'
import { makeApp } from './helpers.ts'
import { GATEWAY } from './fixtures.ts'
import type { GatewayStatus } from 'portta-contracts'

describe('GET /api/gateway dashboard', () => {
  it('states plainly that the loopback path is loopback-only', async () => {
    const { app } = makeApp({ containers: GATEWAY }, { dashboardEnabled: true })
    const status = (await (await app.request('/api/gateway')).json()) as GatewayStatus
    expect(status.dashboard.enabled).toBe(true)
    expect(status.dashboard.expose).toBe('local')
    expect(status.dashboard.endpoints[0]).toMatchObject({
      scope: 'local',
      url: 'http://127.0.0.1:8080/dashboard/',
      usable: true,
    })
  })

  it('derives a domain address when expose is domain', async () => {
    const { app } = makeApp(
      { containers: GATEWAY },
      {
        dashboardEnabled: true,
        dashboardExpose: 'domain',
        dashboardAdvertisedHost: 'portta-traefik.dev.example.com',
        domain: 'dev.example.com',
        domainMode: 'custom',
      },
    )
    const status = (await (await app.request('/api/gateway')).json()) as GatewayStatus
    expect(status.dashboard.expose).toBe('domain')
    expect(status.dashboard.advertisedHost).toBe('portta-traefik.dev.example.com')
    expect(status.dashboard.endpoints.some((entry) => entry.url.includes('portta-traefik'))).toBe(true)
  })
})
