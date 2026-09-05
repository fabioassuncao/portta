import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, statSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { parseEnv, patchEnvFile, prepareEnvFile, reconcileEnv, setEnvValue } from './env.ts'

const root = resolve(import.meta.dirname, '../../..')
const shell = join(root, 'scripts/lib/env.sh')
const template = '# Portta environment structure: 1\n# Panel\nA=one\nB=two\n\n# Database\nC=three\n'
function fixture(text: string) {
  const directory = mkdtempSync(join(tmpdir(), 'portta-contract-'))
  const file = join(directory, '.env')
  writeFileSync(join(directory, '.env.example'), template)
  writeFileSync(file, text)
  return file
}
function bash(file: string, operation: string, key = '', value = '') {
  execFileSync('bash', ['-c', '. "$1"; portta_env_edit "$2" "$3" "$4" "$5"', '_', shell, file, operation, key, value])
}
describe('shell / TypeScript document parity', () => {
  for (const [text, key, value] of [
    [template, 'A', 'new'],
    ['# Panel\r\n  export A = "8081"  # port\r\n\r\nB=unchanged\r\n', 'A', '9000'],
    [template.replace('B=two\n', ''), 'B', 'two'],
    [template.replace('A=one\n', ''), 'A', 'one'],
    ['A=old', 'A', 'new'],
    ['A=old\n', 'A', "a$b#c'\\d"],
    [template, 'UNKNOWN', 'literal'],
    [template, 'A', 'a\\nb'],
    [template, 'A', 'final\\'],
    [template, 'A', '$$\\'],
  ]) {
    it(`updates ${key} without structural drift (${JSON.stringify(text).slice(0, 35)})`, () => {
      const file = fixture(text!)
      const before = statSync(file).ino
      bash(file, 'set', key, value)
      expect(readFileSync(file, 'utf8')).toBe(setEnvValue(text!, key!, value!, template))
      expect(statSync(file).ino).toBe(before)
      expect(statSync(file).mode & 0o777).toBe(0o600)
    })
  }
  it('normalizes once, preserving unknown keys and personal comments', () => {
    const old = '# Personal note\nC=custom # Personal inline note\nA=chosen\nCUSTOM=retained\n'
    const file = fixture(old)
    bash(file, 'prepare')
    const result = readFileSync(file, 'utf8')
    expect(result).toBe(reconcileEnv(old, template))
    bash(file, 'prepare')
    expect(readFileSync(file, 'utf8')).toBe(result)
    expect(readFileSync(`${file}.before-structure`, 'utf8')).toBe(old)
  })
  it('creates from the real template, persists secrets, and does not rewrite on a second run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'portta-prepare-'))
    const file = join(directory, '.env')
    copyFileSync(join(root, '.env.example'), join(directory, '.env.example'))
    prepareEnvFile(file)
    const text = readFileSync(file, 'utf8')
    const modified = statSync(file).mtimeMs
    expect([...parseEnv(text).keys()]).toEqual([...parseEnv(readFileSync(join(root, '.env.example'), 'utf8')).keys()])
    expect(parseEnv(text).get('PORTTA_AUTH_SECRET')).toMatch(/^[a-f0-9]{64}$/)
    prepareEnvFile(file)
    expect(readFileSync(file, 'utf8')).toBe(text)
    expect(statSync(file).mtimeMs).toBe(modified)
    execFileSync('bash', ['-c', '. "$1"; portta_prepare_env "$2"', '_', shell, file])
    expect(readFileSync(file, 'utf8')).toBe(text)
  })
  it('serializes simultaneous shell and TypeScript patches', async () => {
    const file = fixture(template)
    const child = spawn('bash', ['-c', '. "$1"; portta_env_edit "$2" set B shell', '_', shell, file])
    const done = new Promise<void>((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`shell exited ${code}`))) })
    patchEnvFile(file, { A: 'typescript' })
    await done
    expect(parseEnv(readFileSync(file, 'utf8'))).toMatchObject(new Map([['A', 'typescript'], ['B', 'shell'], ['C', 'three']]))
  })
})
