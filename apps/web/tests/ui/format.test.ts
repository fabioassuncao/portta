import { describe, expect, it } from 'vitest'
import { bytes, expiresIn, shortImage, uptime } from '@/lib/format'

describe('formatting', () => {
  it('reads an uptime at a glance', () => {
    expect(uptime(45)).toBe('45s')
    expect(uptime(90)).toBe('1m')
    expect(uptime(3600 * 5 + 60 * 7)).toBe('5h 7m')
    expect(uptime(86400 * 2 + 3600 * 3)).toBe('2d 3h')
    expect(uptime(null)).toBe('-')
  })

  it('says when a bridge expires', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(expiresIn(null)).toBe('no expiry')
    expect(expiresIn(now - 10)).toBe('expired')
    expect(expiresIn(now + 3600)).toMatch(/^in 1h/)
  })

  it('keeps image names readable', () => {
    expect(shortImage('nginx:1.31.4-alpine')).toBe('nginx:1.31.4-alpine')
    expect(shortImage('ghcr.io/acme/team/api:v2')).toBe('team/api:v2')
    expect(shortImage('postgres@sha256:abc')).toBe('postgres')
  })

  it('prints sizes people recognise', () => {
    expect(bytes(0)).toBe('-')
    expect(bytes(512)).toBe('512 B')
    expect(bytes(1024 * 1024 * 3)).toBe('3.0 MB')
    expect(bytes(17_179_869_184)).toBe('16 GB')
  })
})
