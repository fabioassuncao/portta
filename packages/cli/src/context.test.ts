import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gatewayContext } from './context.js'

/**
 * A gateway root is VERSION plus the compose files the resolved configuration
 * names, so the fixture writes exactly those.
 */
function fixture(env: string): string {
  const root = mkdtempSync(join(tmpdir(), 'portta-context-'))
  mkdirSync(join(root, 'docker/compose/attach'), { recursive: true })
  mkdirSync(join(root, 'docker/compose/profiles'), { recursive: true })
  mkdirSync(join(root, 'docker/compose/features'), { recursive: true })
  writeFileSync(join(root, 'VERSION'), '0.2.0\n')
  for (const file of ['compose.yaml', 'attach/host.yaml', 'attach/tailscale.yaml', 'profiles/local.yaml', 'profiles/remote.yaml', 'profiles/public.yaml', 'features/web.yaml', 'features/db.yaml', 'features/web-bind.yaml', 'features/web-dev.yaml', 'features/web-build.yaml', 'features/auth-build.yaml', 'features/auth-dev.yaml']) {
    writeFileSync(join(root, 'docker/compose', file), '{}\n')
  }
  writeFileSync(join(root, '.env'), env)
  return root
}

describe('installation values win over inherited environment', () => {
  let root: string
  const saved = process.env['PORTTA_WEB']

  beforeEach(() => { root = fixture('PORTTA_WEB=true\n') })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    if (saved === undefined) delete process.env['PORTTA_WEB']
    else process.env['PORTTA_WEB'] = saved
  })

  it('an inherited value cannot override persisted installation configuration', () => {
    process.env['PORTTA_WEB'] = 'false'
    expect(gatewayContext({ root }).config.webEnabled).toBe(true)
  })

  // The regression: `web up` wrote PORTTA_WEB=true, re-resolved, and read the
  // inherited false back. Compose was then handed a file list without the
  // panel overlays and asked to start `web`, which answered "no such service".
  it('but a value just written wins, or the overlays it selects go missing', () => {
    process.env['PORTTA_WEB'] = 'false'
    const context = gatewayContext({ root, overrides: { PORTTA_WEB: 'true' } })
    expect(context.config.webEnabled).toBe(true)
    expect(context.composeFiles).toContain('docker/compose/features/web.yaml')
  })
})

describe('the resolved values reach Compose', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  // Traefik bakes PORTTA_DOMAIN into its default rule and publishes
  // PORTTA_BIND_ADDRESS. Both are derived, so handing Compose the raw .env
  // values starts a gateway that disagrees with every command describing it.
  it('the derived domain replaces the stored one', () => {
    root = fixture('PORTTA_DOMAIN_MODE=auto\nPORTTA_PUBLIC_IP=203.0.113.10\nPORTTA_DOMAIN=localhost\n')
    const context = gatewayContext({ root })
    expect(context.config.domain).toBe('203-0-113-10.sslip.io')
    expect(context.env['PORTTA_DOMAIN']).toBe('203-0-113-10.sslip.io')
  })

  it('and the public profile really binds every interface', () => {
    root = fixture('PORTTA_PROFILE=remote-public\nPUBLIC_DOMAIN=dev.example.test\nPORTTA_BIND_ADDRESS=127.0.0.1\n')
    const context = gatewayContext({ root })
    expect(context.config.bindAddress).toBe('0.0.0.0')
    expect(context.env['PORTTA_BIND_ADDRESS']).toBe('0.0.0.0')
  })

  it('a checkout does not imply the auth build overlay', () => {
    root = fixture('')
    mkdirSync(join(root, 'apps/web'), { recursive: true })
    mkdirSync(join(root, 'apps/auth'), { recursive: true })
    writeFileSync(join(root, 'apps/web/Dockerfile'), '')
    expect(gatewayContext({ root }).composeFiles).not.toContain('docker/compose/features/auth-build.yaml')
  })

  it('an installation root does not', () => {
    root = fixture('PORTTA_WEB=true\n')
    expect(gatewayContext({ root }).composeFiles).not.toContain('docker/compose/features/auth-build.yaml')
  })
})
