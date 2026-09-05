import { describe, expect, it } from 'vitest'
import { localReleaseBuilds } from './build.ts'

describe('local release builds', () => {
  it('builds every Portta-owned image with the VERSION release', () => {
    const builds = localReleaseBuilds('/work/portta', '0.8.0')
    expect(builds.map(({ image }) => image)).toEqual([
      'fabioassuncao/portta:0.8.0',
      'fabioassuncao/portta-apply:0.8.0',
      'fabioassuncao/portta-toolbox:0.8.0',
    ])
    for (const build of builds) {
      expect(build.args).toContain('PORTTA_VERSION=0.8.0')
      expect(build.args).toContain(build.image)
    }
    expect(builds[0]?.args).toContain('runtime')
  })
})
