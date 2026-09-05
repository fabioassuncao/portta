import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'

const RETIRED_KEYS = new Set(['PORTTA_WEB_DEV_PORT', 'PORTTA_WEB_AUTH', 'PORTTA_WEB_AUTH_USER', 'PORTTA_WEB_AUTH_HASH'])
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
export const ENV_STRUCTURE = '# Portta environment structure: 1'
const assignment = /^([ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*)(.*)$/

function parts(raw: string): { value: string; suffix: string; quote: string } {
  const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : ''
  if (quote) {
    let end = 1
    for (; end < raw.length; end++) {
      if (raw[end] === '\\' && (raw[end + 1] === quote || (quote === '"' && raw[end + 1] === '\\'))) { end++; continue }
      if (raw[end] === quote) break
    }
    if (end === raw.length || !/^[ \t]*(?:#.*)?$/.test(raw.slice(end + 1))) throw new Error('invalid quoted .env value')
    const value = quote === "'"
      ? raw.slice(1, end).replace(/\\'/g, "'")
      : raw.slice(1, end).replace(/\\(["\\$nrt])/g, (_match, char: string) => ({ n: '\n', r: '\r', t: '\t' }[char] ?? char)).replace(/\$\$/g, '$')
    return { value, suffix: raw.slice(end + 1), quote }
  }
  const match = /^(.*?)([ \t]+#.*|[ \t]*)$/.exec(raw)!
  return { value: match[1]!, suffix: match[2]!, quote: '' }
}

export function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = assignment.exec(line)
    if (!match) continue
    const key = match[2]!
    if (values.has(key)) throw new Error(`duplicate .env key: ${key}`)
    values.set(key, parts(match[3]!).value)
  }
  return values
}

function encode(value: string, quote = ''): string {
  // Compose treats backslashes literally inside single quotes. Double quotes
  // support escaping backslashes (including a final one) and $$ is literal $.
  if (value.includes('\\') || quote === '"') {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, () => '$$')}"`
  }
  if (quote === "'" || /[$\s#'"\\]/.test(value)) return `'${value.replace(/'/g, "\\'")}'`
  return value
}

/** Change a value in place; use template neighbours when the key is absent. */
export function setEnvValue(text: string, key: string, value: string, template = ''): string {
  if (!KEY.test(key)) throw new Error(`refusing to write invalid .env key: ${key}`)
  if (/[\n\r]/.test(value)) throw new Error(`refusing to write a multi-line value for ${key}`)
  const values = parseEnv(text)
  if (values.get(key) === value && values.has(key)) return text
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(eol)
  const index = lines.findIndex(line => assignment.exec(line)?.[2] === key)
  if (index >= 0) {
    const match = assignment.exec(lines[index]!)!
    const old = parts(match[3]!)
    lines[index] = `${match[1]}${encode(value, old.quote)}${old.suffix}`
    return lines.join(eol)
  }
  const keys = [...parseEnv(template).keys()]
  const position = keys.indexOf(key)
  const block = template.split(/\r?\n/)
  const templateIndex = block.findIndex(line => assignment.exec(line)?.[2] === key)
  let start = templateIndex
  while (start > 0 && !assignment.test(block[start - 1]!)) start--
  const prefix = templateIndex < 0 ? [] : block.slice(start, templateIndex)
  const newLines = [...prefix, `${key}=${encode(value)}`]
  if (position >= 0) {
    // Prefer the preceding known key: its successor's comments stay attached.
    for (let i = position - 1; i >= 0; i--) {
      const anchor = lines.findIndex(line => assignment.exec(line)?.[2] === keys[i])
      if (anchor >= 0) { lines.splice(anchor + 1, 0, ...newLines); return lines.join(eol) }
    }
    for (let i = position + 1; i < keys.length; i++) {
      const successor = lines.findIndex(line => assignment.exec(line)?.[2] === keys[i])
      if (successor >= 0) {
        let anchor = successor
        while (anchor > 0 && !assignment.test(lines[anchor - 1]!)) anchor--
        const existingComments = lines.slice(anchor, successor)
        const alreadyHasHeading = prefix.some(line => line.trim()) && prefix.filter(line => line.trim()).every(line => existingComments.includes(line))
        lines.splice(alreadyHasHeading ? successor : anchor, 0, ...(alreadyHasHeading ? [`${key}=${encode(value)}`] : newLines))
        return lines.join(eol)
      }
    }
  }
  return `${text}${text && !text.endsWith(eol) ? eol : ''}${newLines.join(eol)}${eol}`
}

/** One-time structural alignment; unknown content is kept, never discarded. */
export function reconcileEnv(text: string, template: string): string {
  const values = parseEnv(text)
  const defaults = parseEnv(template)
  if (!text) return template
  if (text.split(/\r?\n/).includes(ENV_STRUCTURE)) {
    let next = text
    for (const [key, value] of defaults) if (!values.has(key)) next = setEnvValue(next, key, value, template)
    return next
  }
  let next = template
  for (const [key, value] of values) if (defaults.has(key)) next = setEnvValue(next, key, value)
  // Keep operator inline comments when moving assignments into the template.
  const original = new Map(text.split(/\r?\n/).flatMap(line => {
    const match = assignment.exec(line)
    return match ? [[match[2]!, parts(match[3]!).suffix] as const] : []
  }))
  next = next.split('\n').map(line => {
    const match = assignment.exec(line)
    const suffix = match ? original.get(match[2]!) : undefined
    return suffix?.includes('#') ? line + suffix : line
  }).join('\n')
  const knownComments = new Set(template.split(/\r?\n/).filter(line => !assignment.test(line)))
  const extra = text.split(/\r?\n/).filter(line => {
    const key = assignment.exec(line)?.[2]
    return key ? !defaults.has(key) && !RETIRED_KEYS.has(key) : line.trim() !== '' && !knownComments.has(line)
  })
  if (extra.length) next += `\n# Preserved installation extensions and comments\n${extra.join('\n')}\n`
  return next
}

export function readEnvFile(path: string): string { return existsSync(path) ? readFileSync(path, 'utf8') : '' }
export function isWritable(path: string): boolean {
  try { accessSync(existsSync(path) ? path : dirname(path), constants.W_OK); return true } catch { return false }
}

/** Keep the inode: .env is a file bind mount in the panel. */
export function writeEnvFile(path: string, text: string): void {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) { chmodSync(path, 0o600); return }
  const backupDirectory = join(dirname(path), '.env-lock')
  const backup = join(existsSync(backupDirectory) ? backupDirectory : dirname(path), `.portta-env.${process.pid}.bak`)
  const had = existsSync(path)
  if (had) { copyFileSync(path, backup); chmodSync(backup, 0o600) }
  let recovered = true
  try { writeFileSync(path, text, { mode: 0o600 }); chmodSync(path, 0o600) }
  catch (cause) {
    if (had) { try { copyFileSync(backup, path) } catch { recovered = false } }
    throw cause
  } finally { if (recovered && existsSync(backup)) unlinkSync(backup) }
}

/** Shared with the shell writer; the lock directory is visible through /state. */
export function updateEnvFile(path: string, update: (text: string, template: string) => string): void {
  const lockDirectory = join(dirname(path), '.env-lock')
  mkdirSync(lockDirectory, { recursive: true, mode: 0o700 })
  const lock = join(lockDirectory, 'writer')
  const deadline = Date.now() + 5000
  for (;;) {
    try { mkdirSync(lock, { mode: 0o700 }); break }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (Date.now() >= deadline) throw new Error(`configuration is locked: ${lock}; retry, or remove the lock after checking no writer is active`)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
  try { writeEnvFile(path, update(readEnvFile(path), readEnvFile(join(dirname(path), '.env.example')))) }
  finally { rmdirSync(lock) }
}

export function patchEnvFile(path: string, values: Record<string, string>): void {
  updateEnvFile(path, (text, template) => {
    let next = text || template
    for (const [key, value] of Object.entries(values)) next = setEnvValue(next, key, value, template)
    return next
  })
}

export function prepareEnvFile(path: string): void {
  updateEnvFile(path, (text, template) => {
    if (!template) throw new Error('missing .env.example for this installation')
    let next = reconcileEnv(text, template)
    if (text && next !== text && !text.split(/\r?\n/).includes(ENV_STRUCTURE) && !existsSync(`${path}.before-structure`)) {
      writeFileSync(`${path}.before-structure`, text, { mode: 0o600 })
    }
    const values = parseEnv(next)
    for (const key of ['PORTTA_AUTH_SECRET', ...(values.get('PORTTA_RUNTIME_DB_MODE') === 'external' ? [] : ['PORTTA_RUNTIME_DB_PASSWORD'])]) {
      if (!values.get(key)) next = setEnvValue(next, key, randomBytes(32).toString('hex'), template)
    }
    if (typeof process.getuid === 'function') {
      for (const key of ['PORTTA_WEB_USER', 'PORTTA_AUTH_USER']) {
        if (!values.get(key)) next = setEnvValue(next, key, `${process.getuid()}:${process.getgid?.() ?? 0}`, template)
      }
    }
    return next
  })
}

/** Installation values win. Runtime selectors (PATH, PORTTA_ROOT, etc.) survive. */
export function mergeEnvironment(file: Map<string, string>, processEnv: NodeJS.ProcessEnv): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(processEnv)) if (value !== undefined) merged[key] = value
  for (const [key, value] of file) merged[key] = value
  return merged
}
