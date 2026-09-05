// The one decision made from the environment, and the two it refuses to make.

import { describe, expect, it } from 'vitest'
import { ConfigError, resolveSecurityMode, trustedOrigins, useSecureCookies } from '../src/security-mode.ts'

const env = (values: Record<string, string> = {}): NodeJS.ProcessEnv => values

describe('the security mode', () => {
  it('is open by default, which is only safe on loopback', () => {
    const security = resolveSecurityMode(env())
    expect(security.mode).toBe('open')
    expect(security.bindAddress).toBe('127.0.0.1')
  })

  // Reaching a loopback panel already means having the machine. Reaching one on
  // 0.0.0.0 does not, so "no authentication" there is an open door — refused at
  // boot rather than warned about, because a warning in a log nobody reads is
  // the same as no warning.
  it('refuses open mode on an address that is not loopback', () => {
    expect(() => resolveSecurityMode(env({ PORTTA_WEB_BIND_ADDRESS: '0.0.0.0' }))).toThrow(ConfigError)
    expect(() => resolveSecurityMode(env({ PORTTA_WEB_BIND_ADDRESS: '0.0.0.0' }))).toThrow(/only allowed on loopback/)
  })

  it('refuses open mode on a panel that is exposed at all', () => {
    expect(() => resolveSecurityMode(env({ PORTTA_WEB_EXPOSE: 'vpn' }))).toThrow(/only allowed on loopback/)
  })

  it('refuses protected mode with no secret to sign sessions with', () => {
    expect(() => resolveSecurityMode(env({ PORTTA_AUTH_MODE: 'required' }))).toThrow(/PORTTA_AUTH_SECRET is required/)
  })

  it('refuses a mode nothing names', () => {
    expect(() => resolveSecurityMode(env({ PORTTA_AUTH_MODE: 'maybe' }))).toThrow(/must be disabled or required/)
  })

  it('accepts protected mode with a secret', () => {
    const security = resolveSecurityMode(env({ PORTTA_AUTH_MODE: 'required', PORTTA_AUTH_SECRET: 'x'.repeat(32) }))
    expect(security.mode).toBe('protected')
    expect(security.secret).toHaveLength(32)
  })
})

describe('the origins a browser may write from', () => {
  it('names the panel and both loopback spellings on its port, never a wildcard', () => {
    const security = resolveSecurityMode(env({ PORTTA_WEB_PORT: '8081' }))
    expect(trustedOrigins(security)).toEqual([
      'http://127.0.0.1:8081',
      'http://127.0.0.1:8081',
      'http://localhost:8081',
    ])
  })

  it('adds the ones the operator configured', () => {
    const security = resolveSecurityMode(
      env({
        PORTTA_AUTH_MODE: 'required',
        PORTTA_AUTH_SECRET: 'x',
        PORTTA_WEB_EXPOSE: 'vpn',
        PORTTA_PANEL_URL: 'https://portta.example.com',
        PORTTA_PANEL_TRUSTED_ORIGINS: 'https://vpn.example.com, https://other.example.com',
      }),
    )
    expect(trustedOrigins(security)).toContain('https://vpn.example.com')
    expect(trustedOrigins(security)).toContain('https://other.example.com')
  })
})

describe('the session cookie', () => {
  // `Secure` on plain HTTP means the browser drops the cookie and nobody can
  // sign in; off under HTTPS means it travels where it should not.
  it('is secure under https and not under plain loopback http', () => {
    const https = resolveSecurityMode(
      env({ PORTTA_AUTH_MODE: 'required', PORTTA_AUTH_SECRET: 'x', PORTTA_WEB_EXPOSE: 'vpn', PORTTA_PANEL_URL: 'https://portta.example.com' }),
    )
    expect(useSecureCookies(https)).toBe(true)
    expect(useSecureCookies(resolveSecurityMode(env()))).toBe(false)
  })
})

describe('read-only mode', () => {
  it('is read from the runtime flag the rest of the panel already uses', () => {
    expect(resolveSecurityMode(env({ PORTTA_RUNTIME_READ_ONLY: 'true' })).readOnly).toBe(true)
    expect(resolveSecurityMode(env()).readOnly).toBe(false)
  })
})

// Compose sets every key in a service's `environment`, whether or not the
// operator gave it a value, so the process sees `''` and not "absent". `??`
// does not catch that: the panel booted with an empty PORTTA_PANEL_URL and
// crashed on `new URL('')` before it could serve anything.
describe('a value Compose set to nothing', () => {
  const emptied = {
    PORTTA_AUTH_MODE: '',
    PORTTA_AUTH_SECRET: '',
    PORTTA_PANEL_URL: '',
    PORTTA_PANEL_TRUSTED_ORIGINS: '',
    PORTTA_WEB_BIND_ADDRESS: '',
    PORTTA_WEB_EXPOSE: '',
    PORTTA_WEB_PORT: '',
  }

  it('is the same as one nobody set', () => {
    const security = resolveSecurityMode(env(emptied))
    expect(security.mode).toBe('open')
    expect(security.secret).toBeNull()
    expect(security.bindAddress).toBe('127.0.0.1')
    expect(security.panelUrl.origin).toBe('http://127.0.0.1:8081')
    expect(security.trustedOrigins).toEqual([])
  })

  it('and an empty secret is still a missing secret in required mode', () => {
    expect(() => resolveSecurityMode(env({ ...emptied, PORTTA_AUTH_MODE: 'required' }))).toThrow(ConfigError)
  })

  it('while a port with no URL beside it still decides the fallback', () => {
    const security = resolveSecurityMode(env({ ...emptied, PORTTA_WEB_PORT: '9000' }))
    expect(security.panelUrl.origin).toBe('http://127.0.0.1:9000')
  })
})

// Per address, and a whole office behind one NAT is one address. Configurable
// for that reason, with a floor so it cannot be turned into no limit at all.
describe('how many sign-in attempts an address gets', () => {
  it('is five unless somebody says otherwise', () => {
    expect(resolveSecurityMode(env()).signInAttempts).toBe(5)
  })

  it('takes a number an operator chose', () => {
    expect(resolveSecurityMode(env({ PORTTA_AUTH_SIGNIN_ATTEMPTS: '25' })).signInAttempts).toBe(25)
  })

  it('and refuses one that would remove the limit', () => {
    for (const value of ['0', '1', '2', '-5', '10000', 'lots', '']) {
      expect(resolveSecurityMode(env({ PORTTA_AUTH_SIGNIN_ATTEMPTS: value })).signInAttempts, value).toBe(5)
    }
  })
})
