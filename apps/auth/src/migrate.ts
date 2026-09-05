import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import {
  isSupportedHash,
  readProtectionStore,
  renderAuthDynamic,
  renderPanelAuth,
  renderShares,
  setProtection,
  SHARES_MARKER,
  writeProtectionStore,
  type ProtectionRecord,
  type ProtectionStore,
} from 'portta-core'

export interface MigrationOptions {
  sharesPath: string
  storePath: string
  authDynamicPath: string
  panelDynamicPath?: string
}

interface LegacyShare {
  id: string
  host: string
  entryPoint: string
  mode: 'public' | 'protected'
  user?: string | null
  hash?: string | null
  project?: string
  service?: string
  container: string
  port: number
}

function legacyShares(path: string): LegacyShare[] {
  if (!existsSync(path)) return []
  const marker = readFileSync(path, 'utf8').split('\n').find((line) => line.startsWith(SHARES_MARKER))
  if (!marker) return []
  const parsed = JSON.parse(marker.slice(SHARES_MARKER.length)) as unknown
  if (!Array.isArray(parsed)) throw new Error('the legacy share marker is not an array')
  return parsed as LegacyShare[]
}

function ensureProtection(store: ProtectionStore, record: Omit<ProtectionRecord, 'epoch'>): { store: ProtectionStore; changed: boolean } {
  const existing = store.protections.find((item) => item.scope === record.scope)
  if (existing) return { store, changed: false }
  return { store: setProtection(store, record), changed: true }
}

function writePrivateAtomic(path: string, text: string): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true })
  const temporary = join(directory, `.${randomBytes(8).toString('hex')}.tmp`)
  try {
    writeFileSync(temporary, text, { mode: 0o600 })
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function migrateLegacyState(options: MigrationOptions): { migrated: number; protections: number } {
  let store = readProtectionStore(options.storePath)
  let migrated = 0
  const shares = legacyShares(options.sharesPath)
  for (const share of shares) {
    if (!share.id || !share.host || !share.entryPoint || !share.container || !Number.isInteger(share.port)) {
      throw new Error(`${share.mode === 'protected' ? 'protected share' : 'share'} ${share.id || '<unknown>'} cannot be migrated`)
    }
    if (share.mode !== 'protected') continue
    if (store.protections.some((item) => item.scope === `share:${share.id}`)) continue
    if (!share.id || !share.host || !share.entryPoint || !share.user || !share.hash || !isSupportedHash(share.hash)) {
      throw new Error(`protected share ${share.id || '<unknown>'} cannot be migrated`)
    }
    const result = ensureProtection(store, {
      scope: `share:${share.id}`, host: share.host, entryPoints: [share.entryPoint], user: share.user, hash: share.hash,
      label: share.service || share.host,
      ...(share.project ? { project: share.project } : {}),
      ...(share.service ? { service: share.service } : {}),
    })
    store = result.store
    if (result.changed) migrated += 1
  }
  // Store first, then the middleware and login routers. Existing BasicAuth
  // files remain untouched until their owning surface deliberately switches.
  writeProtectionStore(options.storePath, store)
  writePrivateAtomic(options.authDynamicPath, renderAuthDynamic(store))
  if (existsSync(options.sharesPath)) writePrivateAtomic(options.sharesPath, renderShares(shares))
  if (options.panelDynamicPath && existsSync(options.panelDynamicPath)) {
    writePrivateAtomic(options.panelDynamicPath, renderPanelAuth())
  }
  return { migrated, protections: store.protections.length }
}

function main(): void {
  const root = process.env['PORTTA_MIGRATION_ROOT'] ?? '/app/state'
  const result = migrateLegacyState({
    sharesPath: process.env['PORTTA_MIGRATION_SHARES'] ?? join(root, 'traefik-dynamic/portta-shares.yaml'),
    storePath: process.env['PORTTA_AUTH_STORE'] ?? join(root, 'auth/protections.json'),
    authDynamicPath: process.env['PORTTA_MIGRATION_AUTH_DYNAMIC'] ?? join(root, 'traefik-dynamic/portta-auth.yaml'),
    panelDynamicPath: process.env['PORTTA_MIGRATION_PANEL_DYNAMIC'] ?? join(root, 'traefik-dynamic/portta-panel.yaml'),
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
