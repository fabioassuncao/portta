import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHARES_MARKER, readProtectionStore } from 'portta-core'
import { migrateLegacyState } from './migrate.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'portta-auth-migrate-'))
  const options = {
    sharesPath: join(root, 'dynamic/portta-shares.yaml'),
    storePath: join(root, 'auth/protections.json'), authDynamicPath: join(root, 'dynamic/portta-auth.yaml'),
    panelDynamicPath: join(root, 'dynamic/portta-panel.yaml'),
  }
  mkdirSync(join(root, 'dynamic'))
  const shares = [{ id: 'a7f3', host: 'store-a7f3.share.dev.example.com', entryPoint: 'websecure', mode: 'protected', user: 'reviewer', hash: '$apr1$abcdefgh$ckT15POyCRlen.h6XtGAZ1', project: 'store', service: 'web', container: 'store-web-1', port: 3000 }]
  writeFileSync(options.sharesPath, `${SHARES_MARKER}${JSON.stringify(shares)}\n`)
  writeFileSync(options.panelDynamicPath, 'http:\n  middlewares:\n    old:\n      basicAuth: {}\n')
  return options
}

describe('legacy auth migration', () => {
  // Shares only: the panel's own credential is not lifted here any more,
  // because the panel does not have one — it signs people in itself.
  it('lifts share credentials before rendering ForwardAuth', () => {
    const options = fixture()
    expect(migrateLegacyState(options)).toEqual({ migrated: 1, protections: 1 })
    const store = readProtectionStore(options.storePath)
    expect(store.protections.map((item) => item.scope)).toEqual(['share:a7f3'])
    const yaml = readFileSync(options.authDynamicPath, 'utf8')
    expect(yaml).toContain('portta-forward-auth:')
    expect(yaml).not.toContain('$apr1$')
    expect(readFileSync(options.sharesPath, 'utf8')).toContain('portta-forward-auth')
    expect(readFileSync(options.sharesPath, 'utf8')).not.toContain('$apr1$')
    expect(readFileSync(options.panelDynamicPath, 'utf8')).not.toContain('basicAuth')
    expect(statSync(options.storePath).mode & 0o777).toBe(0o600)
    expect(statSync(options.authDynamicPath).mode & 0o777).toBe(0o600)
  })

  it('is idempotent and does not bump an existing epoch', () => {
    const options = fixture()
    migrateLegacyState(options)
    expect(migrateLegacyState(options).migrated).toBe(0)
    expect(readProtectionStore(options.storePath).protections.every((item) => item.epoch === 1)).toBe(true)
  })

  it('reports an unmigratable protected share without replacing existing state', () => {
    const options = fixture()
    migrateLegacyState(options)
    const before = readFileSync(options.storePath, 'utf8')
    writeFileSync(options.sharesPath, `${SHARES_MARKER}${JSON.stringify([{ id: 'bad', mode: 'protected', host: 'bad.example', entryPoint: 'web' }])}\n`)
    expect(() => migrateLegacyState(options)).toThrow('protected share bad cannot be migrated')
    expect(readFileSync(options.storePath, 'utf8')).toBe(before)
  })

  it('tightens pre-existing output modes', () => {
    const options = fixture()
    writeFileSync(options.authDynamicPath, 'old', { mode: 0o644 })
    chmodSync(options.authDynamicPath, 0o644)
    migrateLegacyState(options)
    expect(statSync(options.authDynamicPath).mode & 0o777).toBe(0o600)
  })
})
