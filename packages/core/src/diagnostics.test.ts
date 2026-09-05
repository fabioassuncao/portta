import { describe, expect, it } from 'vitest'
import {
  applicationBinds,
  authStoreVerdict,
  componentVerdict,
  dashboardExposeRefusal,
  dashboardVerdict,
  duplicates,
  envPermissionVerdict,
  exposureVerdict,
  githubKeyHostPath,
  hasUninterpolatedLabel,
  imageTagVerdict,
  keyModeIsPrivate,
  looksLikeDatastore,
  meetsMinimum,
  panelAuthVerdicts,
  publishesSensitivePort,
  summarise,
  traefikServiceNames,
  versionMajor,
} from './diagnostics.ts'

describe('version comparison', () => {
  it('reads the major from every shape Docker and Compose report', () => {
    expect(versionMajor('29.4.0')).toBe(29)
    expect(versionMajor('v22.22.1')).toBe(22)
    expect(versionMajor('2.39.4')).toBe(2)
    expect(versionMajor(' 24 ')).toBe(24)
  })

  it('answers null rather than 0 for something that is not a version', () => {
    expect(versionMajor('unknown')).toBeNull()
    expect(versionMajor('')).toBeNull()
  })

  // A missing version must not read as "old enough": that would pass a check
  // on a daemon nobody could reach.
  it('never meets a minimum it cannot read', () => {
    expect(meetsMinimum('unknown', 24)).toBe(false)
    expect(meetsMinimum('23.0.1', 24)).toBe(false)
    expect(meetsMinimum('24.0.0', 24)).toBe(true)
  })
})

describe('.env permissions', () => {
  it('passes only when nothing outside the owner can read it', () => {
    expect(envPermissionVerdict('600').status).toBe('pass')
    expect(envPermissionVerdict('400').status).toBe('pass')
    expect(envPermissionVerdict('700').status).toBe('pass')
  })

  it('warns for group- or world-readable, and names the fix', () => {
    for (const mode of ['644', '640', '664', '666', '604']) {
      const verdict = envPermissionVerdict(mode)
      expect(verdict.status, mode).toBe('warn')
      expect(verdict.fix).toBe('chmod 600 .env')
    }
  })

  it('says so rather than guessing when the mode cannot be read', () => {
    expect(envPermissionVerdict(null).status).toBe('warn')
  })
})

describe('image pinning', () => {
  it('accepts a pinned tag', () => {
    expect(imageTagVerdict('traefik:v3.7.12').status).toBe('pass')
  })

  it('warns on the floating tag and on no tag at all', () => {
    expect(imageTagVerdict('traefik:latest').status).toBe('warn')
    expect(imageTagVerdict('traefik').status).toBe('warn')
  })

  // A registry port is a colon that is not a tag.
  it('does not mistake a registry port for a tag', () => {
    expect(imageTagVerdict('registry.example.com:5000/traefik').status).toBe('warn')
    expect(imageTagVerdict('registry.example.com:5000/traefik:v3').status).toBe('pass')
  })
})

describe('exposure', () => {
  const loopback = '80/tcp=127.0.0.1:80 443/tcp=127.0.0.1:443'
  const everywhere = '80/tcp=0.0.0.0:80 443/tcp=0.0.0.0:443'

  it('fails a local profile that publishes an application on every interface', () => {
    expect(exposureVerdict('local', everywhere, false)?.status).toBe('fail')
    expect(exposureVerdict('local', loopback, false)?.status).toBe('pass')
  })

  // The panel's own entrypoint is public on purpose in `public` access mode,
  // and is the one port that is authenticated. Judging it as an application
  // entrypoint would make a correct configuration read as a finding.
  it('leaves the authenticated panel entrypoint out of the application verdict', () => {
    const withPanel = `${loopback} 8090/tcp=0.0.0.0:8443`
    expect(applicationBinds(withPanel, true)).toBe(loopback)
    expect(applicationBinds(withPanel, false)).toBe(withPanel)
    expect(exposureVerdict('local', withPanel, true)?.status).toBe('pass')
    expect(exposureVerdict('local', withPanel, false)?.status).toBe('fail')
  })

  it('fails a private profile bound to every interface', () => {
    expect(exposureVerdict('remote-private', everywhere, false)?.status).toBe('fail')
    expect(exposureVerdict('remote-private', loopback, false)?.status).toBe('pass')
  })

  // Public is a decision, not an accident: it warns so the reader sees it, and
  // never fails, because that is what the profile was chosen for.
  it('warns rather than fails on the public profile', () => {
    expect(exposureVerdict('remote-public', everywhere, false)?.status).toBe('warn')
  })
})

describe('sensitive ports', () => {
  it('catches a database or the Docker API published on every interface', () => {
    for (const port of ['5432/tcp', '3306/tcp', '6379/tcp', '27017/tcp', '2375/tcp', '2376/tcp']) {
      expect(publishesSensitivePort(`0.0.0.0:9999->${port}`), port).toBe(true)
    }
  })

  it('leaves a loopback publish alone, which is how every bridge works', () => {
    expect(publishesSensitivePort('127.0.0.1:55432->5432/tcp')).toBe(false)
  })

  it('does not fire on an ordinary HTTP port', () => {
    expect(publishesSensitivePort('0.0.0.0:8080->8080/tcp')).toBe(false)
  })
})

describe('the Traefik dashboard', () => {
  // It exposes the routing internals of every project on the host, so
  // anything but loopback is a failure rather than a warning.
  it('fails anywhere but loopback, and passes when it is off', () => {
    expect(dashboardVerdict(false, '0.0.0.0', '8080').status).toBe('pass')
    expect(dashboardVerdict(true, '127.0.0.1', '8080').status).toBe('pass')
    expect(dashboardVerdict(true, '::1', '8080').status).toBe('pass')
    expect(dashboardVerdict(true, '0.0.0.0', '8080').status).toBe('fail')
    expect(dashboardVerdict(true, '100.87.243.7', '8080').status).toBe('fail')
  })

  it('still fails a non-loopback bind when the domain exposure is on', () => {
    expect(dashboardVerdict(true, '0.0.0.0', '8080').status).toBe('fail')
  })

  it('refuses a dashboard routed on a domain, whatever else is configured', () => {
    expect(dashboardExposeRefusal({ PORTTA_DASHBOARD: 'true', PORTTA_DASHBOARD_EXPOSE: 'domain' }))
      .toMatch(/no credential of its own/)
    expect(dashboardExposeRefusal({
      PORTTA_DASHBOARD: 'true',
      PORTTA_DASHBOARD_EXPOSE: 'domain',
      PORTTA_DOMAIN: 'dev.example.com',
      PORTTA_DASHBOARD_ADVERTISED_HOST: 'router.dev.example.com',
    })).toMatch(/no credential of its own/)
  })

  it('says nothing about a dashboard on loopback, or one that is off', () => {
    expect(dashboardExposeRefusal({ PORTTA_DASHBOARD: 'true', PORTTA_DASHBOARD_EXPOSE: 'local' })).toBeNull()
    expect(dashboardExposeRefusal({ PORTTA_DASHBOARD: 'false', PORTTA_DASHBOARD_EXPOSE: 'domain' })).toBeNull()
  })
})

describe('the panel front door', () => {
  const base = {
    expose: 'local', bindAddress: '127.0.0.1', port: '8081',
    authMode: 'disabled', secretPresent: false, legacyPanelAuth: false, readOnly: false,
  }
  const byId = (checks: ReturnType<typeof panelAuthVerdicts>) => Object.fromEntries(checks.map((entry) => [entry.id, entry]))

  it('needs nobody to sign in on loopback', () => {
    expect(byId(panelAuthVerdicts(base))['web.auth']?.status).toBe('pass')
  })

  // The tailnet is a boundary, and it is not the only one the panel needs: a
  // tailnet has other people on it, and the panel can stop every container.
  it('fails a panel published on the tailnet that asks nobody who they are', () => {
    const checks = byId(panelAuthVerdicts({ ...base, expose: 'tailscale', bindAddress: '100.64.0.2' }))
    expect(checks['web.auth']?.status).toBe('fail')
    expect(checks['web.auth']?.fix).toMatch(/panel\.auth required/)
  })

  it('fails a routed panel with nothing in front of it', () => {
    const checks = byId(panelAuthVerdicts({ ...base, expose: 'public' }))
    expect(checks['web.auth']?.status).toBe('fail')
    expect(checks['web.auth']?.fix).toMatch(/panel\.auth required/)
  })

  it('passes a routed panel that signs people in', () => {
    const checks = byId(panelAuthVerdicts({ ...base, expose: 'public', authMode: 'required', secretPresent: true }))
    expect(checks['web.auth']?.status).toBe('pass')
    expect(checks['web.auth.secret']?.status).toBe('pass')
  })

  // Without it the panel process refuses to boot, so this is a host that will
  // not come up rather than one that is quietly open.
  it('fails required mode with no secret to sign sessions with', () => {
    const checks = byId(panelAuthVerdicts({ ...base, authMode: 'required', secretPresent: false }))
    expect(checks['web.auth.secret']?.status).toBe('fail')
  })

  it('says when an upgraded host still carries the old Traefik credential', () => {
    expect(byId(panelAuthVerdicts({ ...base, legacyPanelAuth: true }))['web.auth.legacy']?.status).toBe('warn')
    expect(byId(panelAuthVerdicts(base))['web.auth.legacy']).toBeUndefined()
  })

  it('warns about a reachable panel that can still stop containers', () => {
    const routed = { ...base, expose: 'public', authMode: 'required', secretPresent: true }
    expect(byId(panelAuthVerdicts(routed))['web.readonly']?.status).toBe('warn')
    expect(byId(panelAuthVerdicts({ ...routed, readOnly: true }))['web.readonly']).toBeUndefined()
    // Not a finding on loopback: nothing outside the host can reach it.
    expect(byId(panelAuthVerdicts(base))['web.readonly']).toBeUndefined()
  })
})

// `portta bootstrap` ends by running doctor, on a host where nothing has been
// started yet. Treating "does not exist" as a failure made bootstrap exit 1 on
// every fresh host, and every CI job that boots the gateway died before `up`.
describe('an unstarted component is not a broken one', () => {
  const verdict = (present: boolean, state: string | null, health: string | null) =>
    componentVerdict('auth.service', 'authentication service', present, state, health, 'portta logs portta-auth')

  it('warns for a container that does not exist yet', () => {
    const answer = verdict(false, null, null)
    expect(answer.status).toBe('warn')
    expect(answer.detail).toBe('container not created')
  })

  it('fails for one that exists and is not running', () => {
    expect(verdict(true, 'created', null).status).toBe('fail')
    expect(verdict(true, 'exited', null).status).toBe('fail')
  })

  it('fails for one that is running and unhealthy', () => {
    expect(verdict(true, 'running', 'unhealthy').status).toBe('fail')
  })

  // Starting is neither: it is a state that resolves itself, and reporting it
  // as broken would make every `up` end in a failed doctor.
  it('warns while a health check is still starting', () => {
    expect(verdict(true, 'running', 'starting').status).toBe('warn')
  })

  it('passes for running and healthy, and for running with no health check', () => {
    expect(verdict(true, 'running', 'healthy').status).toBe('pass')
    expect(verdict(true, 'running', null).status).toBe('pass')
  })
})

describe('the authentication store', () => {
  it('is not created yet when nothing has ever run', () => {
    const answer = authStoreVerdict(false, null, false)
    expect(answer.status).toBe('warn')
    expect(answer.detail).toBe('not created yet')
  })

  it('is broken when the service is running without it', () => {
    expect(authStoreVerdict(false, null, true).status).toBe('fail')
  })

  // It holds every protected host's credential.
  it('must be owner-only', () => {
    expect(authStoreVerdict(true, '600', true).status).toBe('pass')
    expect(authStoreVerdict(true, '644', true).status).toBe('fail')
    expect(authStoreVerdict(true, null, true).status).toBe('fail')
  })
})

describe('the GitHub App key path', () => {
  // Passing on a file the panel never reads is worse than having no check: it
  // certifies the wrong thing.
  it('translates a path under the mounted directory to its host path', () => {
    expect(githubKeyHostPath('/app/state/github/app.pem', '/opt/portta')).toBe('/opt/portta/state/github/app.pem')
    expect(githubKeyHostPath('/app/state/github/portta.2026-09-02.private-key.pem', '/opt/portta'))
      .toBe('/opt/portta/state/github/portta.2026-09-02.private-key.pem')
  })

  it('refuses anything the panel could not open', () => {
    expect(githubKeyHostPath('/run/secrets/app.pem', '/opt/portta')).toBeNull()
    expect(githubKeyHostPath('/app/state/github/', '/opt/portta')).toBeNull()
    expect(githubKeyHostPath('/app/state/github-old/app.pem', '/opt/portta')).toBeNull()
    expect(githubKeyHostPath('/app/state/github/../../etc/shadow', '/opt/portta')).toBeNull()
    expect(githubKeyHostPath('app.pem', '/opt/portta')).toBeNull()
  })

  it('accepts only an owner-only key', () => {
    expect(keyModeIsPrivate('600')).toBe(true)
    expect(keyModeIsPrivate('400')).toBe(true)
    expect(keyModeIsPrivate('644')).toBe(false)
    expect(keyModeIsPrivate(null)).toBe(false)
  })
})

describe('collisions', () => {
  it('reports only what appears more than once, sorted', () => {
    expect(duplicates(['b', 'a', 'b', 'c', 'a'])).toEqual(['a', 'b'])
    expect(duplicates(['a', 'b'])).toEqual([])
  })
})

describe('label interpolation', () => {
  // Compose interpolates ${VAR} inside a label written in list form but not
  // inside a mapping key, so a project using the map form ships a literal.
  it('finds a literal in a Traefik label, in the key or the value', () => {
    expect(hasUninterpolatedLabel({ 'traefik.http.routers.${NAME}.rule': 'Host(`x`)' })).toBe(true)
    expect(hasUninterpolatedLabel({ 'traefik.http.routers.a.rule': 'Host(`${HOST}`)' })).toBe(true)
  })

  it('ignores a literal outside the Traefik namespace', () => {
    expect(hasUninterpolatedLabel({ 'com.example.thing': '${X}' })).toBe(false)
    expect(hasUninterpolatedLabel({ 'traefik.enable': 'true' })).toBe(false)
  })
})

describe('Traefik service names', () => {
  it('reads each declared service once', () => {
    expect(traefikServiceNames({
      'traefik.http.services.web.loadbalancer.server.port': '3000',
      'traefik.http.services.web.loadbalancer.server.scheme': 'http',
      'traefik.http.services.api.loadbalancer.server.port': '4000',
      'traefik.http.routers.web.rule': 'Host(`x`)',
    }).sort()).toEqual(['api', 'web'])
  })
})

describe('datastores', () => {
  it('recognises the families that do not belong on the shared HTTP network', () => {
    for (const image of ['postgres:18', 'mysql:8', 'mariadb:11', 'redis:7', 'mongo:7', 'memcached:1.6']) {
      expect(looksLikeDatastore(image), image).toBe(true)
    }
    expect(looksLikeDatastore('nginx:1.27')).toBe(false)
  })
})

describe('the summary', () => {
  // Warnings never fail the run: Portta needs Docker and a shell, and most of
  // what warns is a convenience on top of that.
  it('counts failures and warnings, and only failures decide ok', () => {
    const checks = [
      { id: 'a', status: 'pass' as const, title: '', detail: '', fix: '' },
      { id: 'b', status: 'warn' as const, title: '', detail: '', fix: '' },
      { id: 'c', status: 'warn' as const, title: '', detail: '', fix: '' },
    ]
    expect(summarise(checks)).toEqual({ failures: 0, warnings: 2, ok: true })
    expect(summarise([...checks, { id: 'd', status: 'fail' as const, title: '', detail: '', fix: '' }]))
      .toEqual({ failures: 1, warnings: 2, ok: false })
  })
})
