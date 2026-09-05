// The only four files the panel is allowed to write into Traefik's dynamic
// configuration directory.
//
// The directory is mounted read-write, which makes the panel able to configure
// Traefik. That capability is bounded by name rather than by intention: a write
// to any other path is refused here, before it happens, the way
// docker/allowlist.ts refuses a Docker call. Everything else in the directory
// (middlewares.yaml, tcp.yaml, local-tls.yaml, anything a user dropped in)
// belongs to the user and is never touched.
//
// See docs/adr/0011-panel-reads-traefik-writes-one-file.md.

import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  quoteDynamicValue,
  readProtectionStore,
  removeProtection,
  renderAuthDynamic,
  renderPanelAuth,
  UnsafeDynamicValueError,
  writeProtectionStore,
} from 'portta-core'
import type { PanelConfig } from '../config.ts'

/** The whole write surface. Nothing is added here without an ADR. */
export const GENERATED_FILES = {
  panel: 'portta-panel.yaml',
  shares: 'portta-shares.yaml',
  aliases: 'portta-aliases.yaml',
  auth: 'portta-auth.yaml',
} as const

export type GeneratedFile = (typeof GENERATED_FILES)[keyof typeof GENERATED_FILES]

const ALLOWED: readonly string[] = Object.values(GENERATED_FILES)

export class DynamicWriteRefused extends Error {
  status = 403
  hint: string
  constructor(message: string, hint = 'this is a panel limit, not a filesystem one') {
    super(message)
    this.name = 'DynamicWriteRefused'
    this.hint = hint
  }
}

export function assertGenerated(name: string): asserts name is GeneratedFile {
  if (!ALLOWED.includes(name)) {
    throw new DynamicWriteRefused(
      `the panel only writes ${ALLOWED.join(', ')} in Traefik's dynamic directory`,
    )
  }
}

/** YAML double-quoted scalar. Refuses anything that would need escaping. */
export function quote(value: string): string {
  try { return quoteDynamicValue(value) }
  catch (error) {
    if (error instanceof UnsafeDynamicValueError) throw new DynamicWriteRefused(error.message)
    throw error
  }
}

export function dynamicPath(dir: string, name: string): string {
  assertGenerated(name)
  return join(dir, name)
}

export function isDirWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function readGenerated(dir: string, name: string): string | null {
  const path = dynamicPath(dir, name)
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Writes through a temporary file in the same directory, so Traefik's watcher
 * never sees a half-written router. Mode 600 keeps runtime routing state private.
 */
export function writeGenerated(dir: string, name: string, contents: string): void {
  const path = dynamicPath(dir, name)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })

  const temporary = join(dir, `.portta-${name}.${process.pid}.tmp`)
  try {
    writeFileSync(temporary, contents, { mode: 0o600 })
    renameSync(temporary, path)
  } catch (cause) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary)
    } catch {
      /* nothing else to do */
    }
    throw cause
  }
}

export function removeGenerated(dir: string, name: string): void {
  const path = dynamicPath(dir, name)
  if (!existsSync(path)) return
  unlinkSync(path)
}

/**
 * Brings Traefik's two Portta-owned auth files in line with what is true.
 *
 * Two things happen here, and they are the same thing: `portta-panel.yaml` is
 * written empty, because the panel signs people in itself, and `portta-auth.yaml`
 * is rendered from the protection store, which covers projects and shares. A
 * store left by an older Portta may still carry the `panel` and `dashboard`
 * scopes; they are removed, so an upgraded host stops sending the panel through
 * a middleware that no longer decides anything.
 *
 * Returns what happened rather than throwing: on Linux the directory may well
 * belong to another user, and a panel that could not write is a diagnostic, not
 * a crash.
 */
export function reconcilePanelDynamic(config: PanelConfig): { written: boolean; reason: string } {
  try {
    const current = readProtectionStore(config.authStore)
    const next = removeProtection(removeProtection(current, 'panel'), 'dashboard')
    const storeChanged = JSON.stringify(current) !== JSON.stringify(next)
    if (storeChanged) writeProtectionStore(config.authStore, next)

    const wantedAuth = renderAuthDynamic(next)
    const wantedPanel = renderPanelAuth()
    const filesChanged =
      readGenerated(config.dynamicDir, GENERATED_FILES.auth) !== wantedAuth ||
      readGenerated(config.dynamicDir, GENERATED_FILES.panel) !== wantedPanel
    if (filesChanged) {
      if (!isDirWritable(config.dynamicDir)) return { written: false, reason: 'the dynamic directory is not writable' }
      writeGenerated(config.dynamicDir, GENERATED_FILES.auth, wantedAuth)
      writeGenerated(config.dynamicDir, GENERATED_FILES.panel, wantedPanel)
    }
    const written = storeChanged || filesChanged
    return { written, reason: written ? 'panel middleware removed and ForwardAuth rendered' : 'already in step' }
  } catch (cause) {
    return { written: false, reason: String(cause) }
  }
}
