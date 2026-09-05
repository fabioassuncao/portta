// The applier's refusals. The panel now reports these back to the operator
// (apps/web/src/server/core/apply.ts), so the codes and wording are contract,
// not just a warning printed on a terminal. See ADR 0026.
import { describe, it, expect } from 'vitest'
import { applyRefusal, applyCreateArguments, applySpec } from './apply.ts'
import { porttaImages } from './images.ts'

describe('applyRefusal', () => {
  it('serves a plain local host', () => {
    expect(applyRefusal({ PORTTA_PROFILE: 'local' })).toBeNull()
  })

  // Both of these used to be refused, on the grounds that the applier would
  // build the panel image "inside itself". It does not: it holds the host's
  // Docker socket, so the context is streamed over it and the host daemon does
  // the build. Compose also builds before it stops anything, so a failed build
  // leaves the gateway untouched.
  it('serves a host that builds the panel image', () => {
    expect(applyRefusal({ PORTTA_WEB_BUILD: 'true' })).toBeNull()
  })

  it('serves a host in panel development mode', () => {
    expect(applyRefusal({ PORTTA_WEB_DEV: 'true' })).toBeNull()
  })

  it('refuses a publicly exposed panel', () => {
    expect(applyRefusal({ PORTTA_WEB_EXPOSE: 'public' })).toContain('apply on the host instead')
  })

  it('refuses the remote-public profile', () => {
    expect(applyRefusal({ PORTTA_PROFILE: 'remote-public' })).toContain('on the host only')
  })
})

describe('the container it would create', () => {
  const args = applyCreateArguments('/opt/portta', applySpec('/opt/portta', '0.3.0'), '0.3.0')

  it('takes no network, so it cannot be a pivot', () => {
    expect(args).toContain('--network')
    expect(args[args.indexOf('--network') + 1]).toBe('none')
  })

  it('fixes its command at creation, with no profile baked in', () => {
    expect(args.slice(-4)).toEqual(['bash', '/opt/portta/bin/portta', 'up', '--wait'])
  })

  // The spec label is what makes `up` replace an applier built for an older
  // image; without the image in it, a host would keep a stale one forever.
  it('records the image in its spec, so a new image supersedes the old', () => {
    expect(applySpec('/opt/portta', '0.3.0')).toContain(porttaImages('0.3.0').apply)
  })
})
