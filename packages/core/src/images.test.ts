import { describe, expect, it } from 'vitest'
import { assertReleaseVersion, porttaImages } from './images.ts'

describe('Portta release images', () => {
  it('derives every local image from one release', () => {
    expect(porttaImages('0.8.0')).toEqual({
      runtime: 'fabioassuncao/portta:0.8.0',
      apply: 'fabioassuncao/portta-apply:0.8.0',
      toolbox: 'fabioassuncao/portta-toolbox:0.8.0',
    })
  })

  it('refuses an empty, floating or malformed release', () => {
    for (const value of ['', 'latest', '0.8', 'v0.8.0', '0.8.0 bad']) {
      expect(() => assertReleaseVersion(value)).toThrow('invalid Portta release version')
    }
  })
})
