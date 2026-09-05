import { describe, expect, it } from 'vitest'
import { branchSuffix, composeNamespace, slug } from './namespace.js'

describe('namespaces', () => {
  it('normalises names for Docker and DNS', () => expect(slug('Base_Empresarial/Issue#59')).toBe('base-empresarial-issue-59'))
  it('keeps the main checkout on the base name', () => expect(composeNamespace('storefront', branchSuffix('main'))).toBe('storefront'))
  it('distinguishes a work branch', () => expect(composeNamespace('storefront', branchSuffix('fix/59-proxy'))).toBe('storefront-fix-59-proxy'))

  // The panel routes Settings by slugging each group's title, so these seven
  // answers are addresses somebody may have bookmarked. The panel used to keep
  // its own copy of `slug` for the browser bundle; it imports this one through
  // `portta-core/browser` now, which is why the corpus that pinned the two
  // together lives here instead.
  it('keeps the settings group routes stable', () => {
    expect(['Gateway', 'Traefik', 'TLS', 'VPN', 'Public access', 'DNS', 'Panel'].map(slug))
      .toEqual(['gateway', 'traefik', 'tls', 'vpn', 'public-access', 'dns', 'panel'])
  })
})
