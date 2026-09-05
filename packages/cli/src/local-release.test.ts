import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GatewayContext } from './context.ts'

const runProcess = vi.hoisted(() => vi.fn())
vi.mock('./process.js', () => ({ runProcess }))

import { requireLocalRelease } from './local-release.ts'

const context = {
  root: '/work/portta',
  version: '0.8.0',
  env: { PORTTA_LOCAL_RELEASE: 'true' },
  config: {} as GatewayContext['config'],
  composeFiles: [],
} satisfies GatewayContext

describe('local release preflight', () => {
  beforeEach(() => runProcess.mockReset())

  it('checks all three release images before convergence', async () => {
    runProcess.mockResolvedValue({ exitCode: 0 })
    await requireLocalRelease(context)
    expect(runProcess.mock.calls.map((call) => call[1][2])).toEqual([
      'fabioassuncao/portta:0.8.0',
      'fabioassuncao/portta-apply:0.8.0',
      'fabioassuncao/portta-toolbox:0.8.0',
    ])
  })

  it('names every missing image and points to just build', async () => {
    runProcess
      .mockResolvedValueOnce({ exitCode: 0 })
      .mockResolvedValueOnce({ exitCode: 1 })
      .mockResolvedValueOnce({ exitCode: 1 })
    await expect(requireLocalRelease(context)).rejects.toMatchObject({
      message: expect.stringContaining('portta-apply:0.8.0'),
      hint: 'run just build',
    })
  })

  it('does nothing outside a Just local-release invocation', async () => {
    await requireLocalRelease({ ...context, env: {} })
    expect(runProcess).not.toHaveBeenCalled()
  })
})
