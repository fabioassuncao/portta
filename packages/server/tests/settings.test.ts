import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv, setEnvValue } from '../src/services/envfile.ts'
import { buildConfigView, discardConfig, patchConfig, pendingChangesOf } from '../src/services/configview.ts'
import { validateCombination, validateValue, ValidationError } from '../src/services/settings.ts'
import { makeApp, testConfig } from './helpers.ts'
import type { ConfigView } from 'portta-contracts'

describe('parsing .env the way the CLI does', () => {
  it('reads plain assignments and skips comments', () => {
    const values = parseEnv('# a comment\nFOO=bar\n\nBAZ=qux\n')
    expect(values.get('FOO')).toBe('bar')
    expect(values.get('BAZ')).toBe('qux')
    expect(values.size).toBe(2)
  })

  it('tolerates `export` and strips one layer of quotes', () => {
    const values = parseEnv('export FOO="bar"\nBAR=\'baz\'\n')
    expect(values.get('FOO')).toBe('bar')
    expect(values.get('BAR')).toBe('baz')
  })

  it('never executes what it reads', () => {
    const values = parseEnv('FOO=$(rm -rf /)\nBAR=`whoami`\n')
    expect(values.get('FOO')).toBe('$(rm -rf /)')
    expect(values.get('BAR')).toBe('`whoami`')
  })

  it('ignores a key that is not a shell identifier', () => {
    expect(parseEnv('not a key=value\nA-B=c\n').size).toBe(0)
  })
})

describe('rewriting .env', () => {
  it('replaces a value in place, keeping the comments around it', () => {
    const before = '# the domain\nPORTTA_DOMAIN=localhost\n# tls\nTLS_ENABLED=false\n'
    const after = setEnvValue(before, 'PORTTA_DOMAIN', 'dev.test')
    expect(after).toBe('# the domain\nPORTTA_DOMAIN=dev.test\n# tls\nTLS_ENABLED=false\n')
  })

  it('appends a key that is not there yet', () => {
    expect(setEnvValue('A=1\n', 'B', '2')).toBe('A=1\nB=2\n')
  })

  it('refuses a key or a value that would corrupt the file', () => {
    expect(() => setEnvValue('', 'BAD KEY', 'x')).toThrowError(/invalid .env key/)
    expect(() => setEnvValue('', 'GOOD', 'line1\nEVIL=1')).toThrowError(/multi-line/)
  })
})

describe('validation', () => {
  it('checks each value against its own rules', () => {
    expect(() => validateValue('PORTTA_HTTP_PORT', '70000')).toThrow(ValidationError)
    expect(() => validateValue('PORTTA_DOMAIN', 'not a domain')).toThrow(ValidationError)
    expect(() => validateValue('TLS_MODE', 'sometimes')).toThrow(ValidationError)
    expect(() => validateValue('TLS_ENABLED', 'maybe')).toThrow(ValidationError)
    expect(() => validateValue('ACME_EMAIL', 'nope')).toThrow(ValidationError)
    expect(() => validateValue('SOMETHING_ELSE', 'x')).toThrowError(/not a setting the panel manages/)
  })

  it('accepts the values the gateway actually uses', () => {
    expect(() => validateValue('PORTTA_DOMAIN', 'vpn.example.com')).not.toThrow()
    expect(() => validateValue('PORTTA_BIND_ADDRESS', '100.64.0.1')).not.toThrow()
    expect(() => validateValue('PUBLIC_DOMAIN', '')).not.toThrow()
    expect(() => validateValue('PORTTA_PROFILE', 'remote-private')).not.toThrow()
    expect(() => validateValue('PORTTA_PROJECTS_HOME', '/srv/projects')).not.toThrow()
    expect(() => validateValue('PORTTA_PROJECTS_HOME', '')).not.toThrow()
    expect(() => validateValue('PORTTA_PROJECTS_HOME', '/')).toThrow(ValidationError)
    expect(() => validateValue('PORTTA_PROJECTS_HOME', '/srv/projects/../..')).toThrow(ValidationError)
  })

  // The panel reads this path; `portta doctor` translates it back to the host.
  // Only `./state/github` is mounted, so a path outside it names a file that is
  // not in the container at all, and the two diagnostics would disagree about a
  // key neither of them could authenticate with.
  it('takes the key filename GitHub gave, and only from the mounted directory', () => {
    const key = 'GITHUB_APP_PRIVATE_KEY_FILE'

    expect(() => validateValue(key, '/app/state/github/portta.2026-09-02.private-key.pem')).not.toThrow()
    expect(() => validateValue(key, '/app/state/github/app.pem')).not.toThrow()
    // Empty falls through to the same default in Compose and in config.ts.
    expect(() => validateValue(key, '')).not.toThrow()

    expect(() => validateValue(key, '/run/secrets/app.pem')).toThrowError(/mounted into the panel/)
    expect(() => validateValue(key, 'app.pem')).toThrow(ValidationError)
    expect(() => validateValue(key, '/app/state/github/')).toThrow(ValidationError)
    expect(() => validateValue(key, '/app/state/github-old/app.pem')).toThrow(ValidationError)
    expect(() => validateValue(key, '/app/state/github/../../etc/shadow')).toThrow(ValidationError)
  })

  it('refuses combinations the CLI would refuse at startup', () => {
    expect(() =>
      validateCombination(new Map([['PORTTA_PROFILE', 'remote-public']])),
    ).toThrowError(/PUBLIC_DOMAIN/)

    expect(() =>
      validateCombination(new Map([
        ['PORTTA_PROFILE', 'remote-public'],
        ['PORTTA_DOMAIN_MODE', 'custom'],
        ['PORTTA_DOMAIN', 'dev.example.com'],
      ])),
    ).not.toThrow()

    expect(() =>
      validateCombination(
        new Map([
          ['PORTTA_PROFILE', 'remote-private'],
          ['PORTTA_BIND_ADDRESS', '0.0.0.0'],
        ]),
      ),
    ).toThrowError(/must not bind 0.0.0.0/)

    expect(() =>
      validateCombination(
        new Map([
          ['TLS_ENABLED', 'true'],
          ['TLS_MODE', 'acme'],
        ]),
      ),
    ).toThrowError(/ACME_EMAIL/)
  })

  it('refuses to publish the panel on every interface', () => {
    expect(() =>
      validateCombination(new Map([['PORTTA_WEB_BIND_ADDRESS', '0.0.0.0']])),
    ).toThrowError(/not published on every interface/)
  })
})

describe('the Settings view and its writes', () => {
  let dir: string
  let envFile: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'portta-web-'))
    envFile = join(dir, '.env')
    writeFileSync(
      envFile,
      '# gateway\nPORTTA_DOMAIN=localhost\nTLS_ENABLED=false\nTS_AUTHKEY=tskey_auth_secret_value\n',
    )
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('exposes catalogue defaults when a key is absent from .env', () => {
    const view = buildConfigView(testConfig({ envFile }))
    const port = view.fields.find((field) => field.key === 'PORTTA_WEB_PORT')
    expect(port?.value).toBeNull()
    expect(port?.defaultValue).toBe('8081')
    expect(port?.effectiveValue).toBe('8081')
    expect(port?.valueSource).toBe('default')
    expect(port?.isSet).toBe(false)

    const bind = view.fields.find((field) => field.key === 'PORTTA_WEB_BIND_ADDRESS')
    expect(bind?.defaultValue).toBe('127.0.0.1')
    expect(bind?.effectiveValue).toBe('127.0.0.1')
    expect(bind?.valueSource).toBe('default')
  })

  it('shows an environment override instead of labelling it as the default', () => {
    process.env['PORTTA_WEB_PORT'] = '9090'
    try {
      const view = buildConfigView(testConfig({ envFile }))
      const port = view.fields.find((field) => field.key === 'PORTTA_WEB_PORT')
      expect(port?.effectiveValue).toBe('9090')
      expect(port?.valueSource).toBe('environment')
    } finally {
      delete process.env['PORTTA_WEB_PORT']
    }
  })

  it('normalises shell-style booleans for form controls', () => {
    process.env['PORTTA_ACCESS_LOG'] = '1'
    try {
      const view = buildConfigView(testConfig({ envFile }))
      const accessLog = view.fields.find((field) => field.key === 'PORTTA_ACCESS_LOG')
      expect(accessLog?.effectiveValue).toBe('true')
      expect(accessLog?.valueSource).toBe('environment')
    } finally {
      delete process.env['PORTTA_ACCESS_LOG']
    }
  })

  it('derives the API reference default from panel reachability', () => {
    const view = buildConfigView(testConfig({ envFile, apiDocs: false }))
    const apiDocs = view.fields.find((field) => field.key === 'PORTTA_RUNTIME_API_DOCS')
    expect(apiDocs?.effectiveValue).toBe('false')
    expect(apiDocs?.valueSource).toBe('derived')
  })

  it('marks a saved value as saved, not as the default', () => {
    const view = buildConfigView(testConfig({ envFile }))
    const domain = view.fields.find((field) => field.key === 'PORTTA_DOMAIN')
    expect(domain?.value).toBe('localhost')
    expect(domain?.isSet).toBe(true)
    expect(domain?.valueSource).toBe('saved')
  })

  it('lists groups in the order the settings pages should appear', () => {
    const view = buildConfigView(testConfig({ envFile }))
    expect(view.groups.filter((name) => name !== 'GitHub')).toEqual([
      'Projects',
      'Project domain',
      'Project access',
      'TLS',
      'DNS',
      'Panel',
      'Traefik',
    ])
  })

  it('accepts the panel hostname keys the address form writes', () => {
    expect(() => validateValue('PORTTA_WEB_HOST', 'portta')).not.toThrow()
    expect(() => validateValue('PORTTA_WEB_HOST', 'portta.example.com')).toThrow(ValidationError)
    expect(() => validateValue('PORTTA_PANEL_ADVERTISED_HOST', 'portta.example.com')).not.toThrow()
  })

  it('never returns a secret value', () => {
    const view = buildConfigView(testConfig({ envFile }))
    const token = view.fields.find((field) => field.key === 'TS_AUTHKEY')
    expect(token?.secret).toBe(true)
    expect(token?.isSet).toBe(true)
    expect(token?.value).toBeNull()
    expect(JSON.stringify(view)).not.toContain('tskey_auth_secret_value')
  })

  it('never returns the panel database password', () => {
    writeFileSync(envFile, `${readFileSync(envFile, 'utf8')}PORTTA_RUNTIME_DB_PASSWORD=database-secret-value\n`)
    const view = buildConfigView(testConfig({ envFile }))
    const password = view.fields.find((field) => field.key === 'PORTTA_RUNTIME_DB_PASSWORD')

    expect(password?.secret).toBe(true)
    expect(password?.isSet).toBe(true)
    expect(password?.value).toBeNull()
    expect(JSON.stringify(view)).not.toContain('database-secret-value')
  })

  it('flags a saved value that the running gateway has not picked up', () => {
    process.env['PORTTA_DOMAIN'] = 'localhost'
    const before = buildConfigView(testConfig({ envFile }))
    expect(before.fields.find((f) => f.key === 'PORTTA_DOMAIN')?.pending).toBe(false)

    patchConfig(testConfig({ envFile }), { PORTTA_DOMAIN: 'dev.test' })
    const after = buildConfigView(testConfig({ envFile }))
    expect(after.fields.find((f) => f.key === 'PORTTA_DOMAIN')?.pending).toBe(true)
    expect(after.pendingRestart).toBe(true)
    expect(after.applyCommand).toBe('./bin/portta up local')
    expect(pendingChangesOf(after.fields)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'PORTTA_DOMAIN',
        from: 'localhost',
        to: 'dev.test',
        secret: false,
        fromSet: true,
        toSet: true,
        restartRequired: true,
      }),
    ]))
    delete process.env['PORTTA_DOMAIN']
  })

  it('puts the running value back when a pending change is discarded', () => {
    process.env['PORTTA_DOMAIN'] = 'localhost'
    process.env['PORTTA_LOG_LEVEL'] = 'INFO'
    try {
      patchConfig(testConfig({ envFile }), { PORTTA_DOMAIN: 'dev.test', PORTTA_LOG_LEVEL: 'DEBUG' })
      expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_DOMAIN=dev.test')

      const one = discardConfig(testConfig({ envFile }), ['PORTTA_DOMAIN'])
      expect(one.discarded).toEqual(['PORTTA_DOMAIN'])
      expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_DOMAIN=localhost')
      expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_LOG_LEVEL=DEBUG')

      const rest = discardConfig(testConfig({ envFile }))
      expect(rest.discarded).toContain('PORTTA_LOG_LEVEL')
      expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_LOG_LEVEL=INFO')
      expect(rest.view.fields.find((field) => field.key === 'PORTTA_LOG_LEVEL')?.pending).toBe(false)
    } finally {
      delete process.env['PORTTA_DOMAIN']
      delete process.env['PORTTA_LOG_LEVEL']
    }
  })

  it('restores a secret from the running process without returning it', () => {
    process.env['TS_AUTHKEY'] = 'tskey_auth_secret_value'
    try {
      patchConfig(testConfig({ envFile }), { TS_AUTHKEY: 'tskey_auth_new_value' })
      expect(readFileSync(envFile, 'utf8')).toContain('tskey_auth_new_value')

      const result = discardConfig(testConfig({ envFile }), ['TS_AUTHKEY'])
      expect(result.discarded).toEqual(['TS_AUTHKEY'])
      expect(readFileSync(envFile, 'utf8')).toContain('tskey_auth_secret_value')
      expect(readFileSync(envFile, 'utf8')).not.toContain('tskey_auth_new_value')
      expect(JSON.stringify(result)).not.toContain('tskey_auth')
    } finally {
      delete process.env['TS_AUTHKEY']
    }
  })

  it('writes the file with mode 600', () => {
    patchConfig(testConfig({ envFile }), { PORTTA_DOMAIN: 'dev.test' })
    expect(statSync(envFile).mode & 0o777).toBe(0o600)
  })

  it('leaves a secret alone when the form sends an empty string', () => {
    patchConfig(testConfig({ envFile }), { TS_AUTHKEY: '' })
    expect(readFileSync(envFile, 'utf8')).toContain('TS_AUTHKEY=tskey_auth_secret_value')
  })

  it('clears a secret when explicitly asked to', () => {
    patchConfig(testConfig({ envFile }), { TS_AUTHKEY: null })
    expect(readFileSync(envFile, 'utf8')).toContain('TS_AUTHKEY=\n')
    expect(readFileSync(envFile, 'utf8')).not.toContain('tskey_auth_secret_value')
  })

  it('normalises the spellings people write for a boolean', () => {
    patchConfig(testConfig({ envFile }), { TLS_ENABLED: 'yes' })
    expect(readFileSync(envFile, 'utf8')).toContain('TLS_ENABLED=true')
  })

  it('writes nothing at all when one value in the batch is invalid', () => {
    const before = readFileSync(envFile, 'utf8')
    expect(() =>
      patchConfig(testConfig({ envFile }), {
        PORTTA_DOMAIN: 'dev.test',
        PORTTA_HTTP_PORT: '-1',
      }),
    ).toThrow(ValidationError)
    expect(readFileSync(envFile, 'utf8')).toBe(before)
  })

  it('refuses a key that is not in the catalogue', () => {
    expect(() => patchConfig(testConfig({ envFile }), { PATH: '/tmp' })).toThrowError(
      /not a setting the panel manages/,
    )
    expect(readFileSync(envFile, 'utf8')).not.toContain('PATH=')
  })

  it('keeps the comments in the file', () => {
    patchConfig(testConfig({ envFile }), { PORTTA_DOMAIN: 'dev.test' })
    expect(readFileSync(envFile, 'utf8')).toContain('# gateway')
  })
})

describe('the config endpoints', () => {
  let dir: string
  let envFile: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'portta-web-api-'))
    envFile = join(dir, '.env')
    writeFileSync(envFile, 'PORTTA_DOMAIN=localhost\nCF_DNS_API_TOKEN=super-secret\n')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('serves the catalogue without any secret in it', async () => {
    const { app } = makeApp({ containers: [] }, { envFile })
    const body = await (await app.request('/api/config')).text()
    expect(body).not.toContain('super-secret')
    const view = JSON.parse(body) as ConfigView
    expect(view.envFile.writable).toBe(true)
    expect(view.groups).toContain('Project access')
  })

  it('saves through PATCH and reports what needs recreating', async () => {
    const { app } = makeApp({ containers: [] }, { envFile })
    const response = await app.request('/api/config', {
      method: 'PATCH',
      body: JSON.stringify({ values: { PORTTA_DOMAIN: 'dev.test' } }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.saved).toEqual(['PORTTA_DOMAIN'])
    expect(result.applyCommand).toContain('portta up')
    expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_DOMAIN=dev.test')
  })

  it('discards pending settings through POST', async () => {
    process.env['PORTTA_DOMAIN'] = 'localhost'
    writeFileSync(envFile, 'PORTTA_DOMAIN=dev.test\nCF_DNS_API_TOKEN=super-secret\n')
    const { app } = makeApp({ containers: [] }, { envFile })
    const response = await app.request('/api/config/discard', {
      method: 'POST',
      body: JSON.stringify({ keys: ['PORTTA_DOMAIN'] }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.discarded).toEqual(['PORTTA_DOMAIN'])
    expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_DOMAIN=localhost')
    expect(JSON.stringify(result)).not.toContain('super-secret')
    delete process.env['PORTTA_DOMAIN']
  })

  it('answers 400 with the offending key, and writes nothing', async () => {
    const { app } = makeApp({ containers: [] }, { envFile })
    const response = await app.request('/api/config', {
      method: 'PATCH',
      body: JSON.stringify({ values: { PORTTA_HTTP_PORT: 'eighty' } }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('PORTTA_HTTP_PORT')
    expect(readFileSync(envFile, 'utf8')).not.toContain('eighty')
  })
})

describe('the panel refuses to be routed without signing people in', () => {
  const routed = (extra: Record<string, string> = {}) =>
    new Map(
      Object.entries({
        PORTTA_WEB_EXPOSE: 'vpn',
        PORTTA_AUTH_MODE: 'required',
        PORTTA_AUTH_SECRET: 'a-secret-long-enough-to-sign-with',
        ...extra,
      }),
    )

  it('accepts a routed panel that asks who you are', () => {
    expect(() => validateCombination(routed())).not.toThrow()
  })

  it('refuses the routed panel with authentication off', () => {
    expect(() => validateCombination(routed({ PORTTA_AUTH_MODE: 'disabled' }))).toThrow(ValidationError)
  })

  it('refuses required with nothing to sign with', () => {
    expect(() => validateCombination(routed({ PORTTA_AUTH_SECRET: '' }))).toThrow(ValidationError)
  })

  it('asks for none of it on loopback, where reaching it already means having the machine', () => {
    expect(() =>
      validateCombination(
        new Map([
          ['PORTTA_WEB_EXPOSE', 'local'],
          ['PORTTA_AUTH_MODE', 'disabled'],
        ]),
      ),
    ).not.toThrow()
  })

  it('allows the dedicated public entrypoint to bind every interface', () => {
    expect(() => validateCombination(routed({
      PORTTA_WEB_EXPOSE: 'public',
      PORTTA_WEB_BIND_ADDRESS: '0.0.0.0',
    }))).not.toThrow()
  })

  it('refuses a public bind outside the dedicated public mode', () => {
    expect(() => validateCombination(routed({
      PORTTA_WEB_EXPOSE: 'vpn',
      PORTTA_WEB_BIND_ADDRESS: '0.0.0.0',
    }))).toThrowError(/not published on every interface/)
  })

  it('requires a tailnet address for direct Tailscale access', () => {
    expect(() => validateCombination(routed({
      PORTTA_WEB_EXPOSE: 'tailscale',
      PORTTA_WEB_BIND_ADDRESS: '127.0.0.1',
    }))).toThrowError(/tailnet address/)
    expect(() => validateCombination(routed({
      PORTTA_WEB_EXPOSE: 'tailscale',
      PORTTA_WEB_BIND_ADDRESS: '100.64.0.12',
    }))).not.toThrow()
  })

  it('requires TLS for a panel routed by domain', () => {
    expect(() => validateCombination(routed({
      PORTTA_WEB_EXPOSE: 'domain',
      PORTTA_PANEL_ADVERTISED_HOST: 'portta.example.com',
      TLS_ENABLED: 'false',
    }))).toThrowError(/requires TLS/)
  })
})

describe('a dashboard on the domain', () => {
  // It used to borrow the panel's BasicAuth credential. The panel signs people
  // in itself now, so there is no credential to borrow, and Traefik's dashboard
  // exposes the routing of every project on the host.
  it('is refused, because it has no credential of its own', () => {
    expect(() =>
      validateCombination(new Map([
        ['PORTTA_DASHBOARD', 'true'],
        ['PORTTA_DASHBOARD_EXPOSE', 'domain'],
        ['PORTTA_DOMAIN', 'dev.example.com'],
      ])),
    ).toThrow(ValidationError)
  })

  it('is accepted on loopback, which is where it belongs', () => {
    expect(() =>
      validateCombination(new Map([
        ['PORTTA_DASHBOARD', 'true'],
        ['PORTTA_DASHBOARD_EXPOSE', 'local'],
      ])),
    ).not.toThrow()
  })
})

describe('the panel URL is an origin, not a URL with a path', () => {
  it('accepts what a browser would reach the panel on', () => {
    expect(() => validateValue('PORTTA_PANEL_URL', 'https://panel.dev.example.com')).not.toThrow()
    expect(() => validateValue('PORTTA_PANEL_URL', 'http://127.0.0.1:8081')).not.toThrow()
    expect(() => validateValue('PORTTA_PANEL_URL', '')).not.toThrow()
  })

  it('refuses a path, a credential or a scheme that is not http', () => {
    for (const bad of ['https://panel.example.com/portta', 'https://user:pw@panel.example.com', 'ftp://panel.example.com', 'panel.example.com']) {
      expect(() => validateValue('PORTTA_PANEL_URL', bad), bad).toThrow(ValidationError)
    }
  })

  it('checks every entry of the trusted list, and names the one that failed', () => {
    expect(() => validateValue('PORTTA_PANEL_TRUSTED_ORIGINS', 'https://a.example.com, https://b.example.com')).not.toThrow()
    expect(() => validateValue('PORTTA_PANEL_TRUSTED_ORIGINS', 'https://a.example.com, nonsense'))
      .toThrow(/nonsense/)
  })
})

describe('a secret is stored and never handed back', () => {
  it('never returns the value it just stored', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-settings-'))
    const config = testConfig({ envFile: join(dir, '.env'), dynamicDir: dir })
    writeFileSync(config.envFile, '')

    const result = patchConfig(config, { PORTTA_AUTH_SECRET: 'a-secret-long-enough-to-sign-with' })
    const field = result.view.fields.find((item) => item.key === 'PORTTA_AUTH_SECRET')
    expect(field?.isSet).toBe(true)
    expect(field?.value).toBeNull()
    expect(JSON.stringify(result)).not.toContain('long-enough-to-sign')
    rmSync(dir, { recursive: true, force: true })
  })
})
