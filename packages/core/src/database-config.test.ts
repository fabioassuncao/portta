import { describe, expect, it } from 'vitest'
import { resolveDatabase } from './database-config.ts'
import { composeFiles, loadGatewayConfig } from './config.ts'
describe('database configuration', () => {
  it('derives escaped credentials for the managed service', () => {
    const result = resolveDatabase({ PORTTA_RUNTIME_DB_PASSWORD: 'p@ss:/?#$', PORTTA_RUNTIME_DB_NAME: 'custom', PORTTA_RUNTIME_DB_USER: 'owner' })
    const url = new URL(result.url!)
    expect(decodeURIComponent(url.password)).toBe('p@ss:/?#$')
    expect(url.username).toBe('owner')
    expect(url.host).toBe('db:5432')
    expect(url.pathname).toBe('/custom')
  })
  it('refuses a silent URL override', () => {
    expect(() => resolveDatabase({ PORTTA_RUNTIME_DATABASE_URL: 'postgres://host/db' })).toThrow('external')
  })
  it('requires a valid external URL', () => {
    expect(() => resolveDatabase({ PORTTA_RUNTIME_DB_MODE: 'external' })).toThrow('requires')
    expect(() => resolveDatabase({ PORTTA_RUNTIME_DB_MODE: 'external', PORTTA_RUNTIME_DATABASE_URL: 'http://host/db' })).toThrow('PostgreSQL')
  })
  it('external mode never selects the managed database overlay', () => {
    const files = composeFiles(loadGatewayConfig({ PORTTA_WEB: 'true', PORTTA_RUNTIME_DB_MODE: 'external' }))
    expect(files).toContain('docker/compose/features/web.yaml')
    expect(files).not.toContain('docker/compose/features/db.yaml')
    expect(resolveDatabase({ PORTTA_RUNTIME_DB_MODE: 'external', PORTTA_RUNTIME_DATABASE_URL: 'postgres://external/db' }).url).toBe('postgres://external/db')
  })
})
