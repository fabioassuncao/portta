import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  requireDocker: vi.fn(),
  inspectContainers: vi.fn(),
  ensureNetwork: vi.fn(),
  networkExists: vi.fn(),
  runProcess: vi.fn(),
  removeApplier: vi.fn(),
  removeRunner: vi.fn(),
  stopMetricsCollector: vi.fn(),
  ensureMetricsCollector: vi.fn(),
  refreshRepositories: vi.fn(),
  ensureApplier: vi.fn(),
  ensureRunner: vi.fn(),
  applyDemo: vi.fn(),
  demoStacksDown: vi.fn(),
  prepareWebUp: vi.fn(),
  finishWebUp: vi.fn(),
  gatewayContext: vi.fn(),
}))

vi.mock('../confirm.js', () => ({ confirm: mocks.confirm }))
vi.mock('../process.js', () => ({ runProcess: mocks.runProcess }))
vi.mock('../docker.js', async () => {
  const actual = await vi.importActual<typeof import('../docker.js')>('../docker.js')
  return {
    ...actual,
    requireDocker: mocks.requireDocker,
    inspectContainers: mocks.inspectContainers,
    ensureNetwork: mocks.ensureNetwork,
    networkExists: mocks.networkExists,
  }
})
vi.mock('../context.js', () => ({
  gatewayContext: mocks.gatewayContext,
  composeArguments: () => ['-f', 'compose.yaml'],
}))
vi.mock('./apply.js', () => ({
  ensureApplier: mocks.ensureApplier,
  removeApplier: mocks.removeApplier,
}))
vi.mock('./runner.js', () => ({
  ensureRunner: mocks.ensureRunner,
  removeRunner: mocks.removeRunner,
}))
vi.mock('./host.js', () => ({
  ensureMetricsCollector: mocks.ensureMetricsCollector,
  stopMetricsCollector: mocks.stopMetricsCollector,
}))
vi.mock('./repos.js', () => ({ refreshRepositories: mocks.refreshRepositories }))
vi.mock('./examples.js', () => ({ applyDemo: mocks.applyDemo, demoStacksDown: mocks.demoStacksDown }))
vi.mock('./web.js', () => ({ prepareWebUp: mocks.prepareWebUp, finishWebUp: mocks.finishWebUp }))

import { authMigrationRunArguments, checkoutLocalEnv, clearRegenerableState, devCommand, doctorReport, downCommand, panelDatabaseVolume, resetCommand, upCommand, type Check } from './lifecycle.js'

describe('what doctor prints', () => {
  it('offers a fix only for a check that did not pass', () => {
    const checks: Check[] = [
      { id: 'env', status: 'pass', message: '.env exists', fix: 'copy .env.example to .env' },
      { id: 'network', status: 'fail', message: 'shared network portta', fix: 'run portta bootstrap' },
    ]
    expect(doctorReport(checks)).toEqual([
      { line: 'ok   .env exists' },
      { line: 'FAIL shared network portta', hint: 'run portta bootstrap' },
    ])
  })

  it('says nothing extra when a failing check has no known fix', () => {
    expect(doctorReport([{ id: 'x', status: 'fail', message: 'something' }])).toEqual([
      { line: 'FAIL something' },
    ])
  })
})

describe('checkout development images', () => {
  it('selects development without leaking a runtime build or image override', () => {
    const values = checkoutLocalEnv()
    expect(values.PORTTA_AUTH_IMAGE).toBe('')
    expect(values.PORTTA_WEB_IMAGE).toBe('')
    expect(values.PORTTA_WEB_BUILD).toBe('false')
    expect(values.PORTTA_WEB_DEV).toBe('true')
  })
})

describe('authentication state migration', () => {
  it('targets the isolated disposable writer as the host user', () => {
    expect(authMigrationRunArguments(true, '501:20')).toEqual([
      'run', '--rm', '--no-deps', '--build', '--user', '501:20',
      'portta-auth-migrate',
    ])
  })

  it('does not invent a Unix user on platforms that do not expose one', () => {
    expect(authMigrationRunArguments(false)).not.toContain('--user')
  })
})

describe('the panel database volume', () => {
  it('defaults to portta-db', () => {
    expect(panelDatabaseVolume({})).toBe('portta-db')
  })

  it('honours PORTTA_DB_VOLUME', () => {
    expect(panelDatabaseVolume({ PORTTA_DB_VOLUME: 'checkout-db' })).toBe('checkout-db')
  })
})

describe('regenerable checkout snapshots', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('empties git and metrics and leaves credentials alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-reset-'))
    roots.push(root)
    mkdirSync(join(root, 'state/git'), { recursive: true })
    mkdirSync(join(root, 'state/metrics'), { recursive: true })
    mkdirSync(join(root, 'state/github'), { recursive: true })
    mkdirSync(join(root, 'state/auth'), { recursive: true })
    writeFileSync(join(root, 'state/git/index.json'), '{}')
    writeFileSync(join(root, 'state/metrics/host.json'), '{}')
    writeFileSync(join(root, 'state/github/app.pem'), 'key')
    writeFileSync(join(root, 'state/auth/secret'), 'keep')
    writeFileSync(join(root, '.env.example'), '# Portta environment structure: 1\nPORTTA_AUTH_SECRET=\nPORTTA_RUNTIME_DB_PASSWORD=\n')
    writeFileSync(join(root, '.env'), 'PORTTA_WEB=true\n')

    expect(clearRegenerableState(root)).toEqual(['state/git', 'state/metrics'])
    expect(existsSync(join(root, 'state/git'))).toBe(true)
    expect(existsSync(join(root, 'state/metrics'))).toBe(true)
    expect(existsSync(join(root, 'state/git/index.json'))).toBe(false)
    expect(existsSync(join(root, 'state/metrics/host.json'))).toBe(false)
    expect(readFileSync(join(root, 'state/github/app.pem'), 'utf8')).toBe('key')
    expect(readFileSync(join(root, 'state/auth/secret'), 'utf8')).toBe('keep')
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('PORTTA_WEB=true\n')
  })

  it('is a no-op when those directories are absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-reset-'))
    roots.push(root)
    expect(clearRegenerableState(root)).toEqual([])
  })
})

describe('resetCommand', () => {
  const roots: string[] = []
  afterEach(() => {
    vi.restoreAllMocks()
    for (const mock of Object.values(mocks)) mock.mockReset()
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function command(options: Record<string, unknown> = { yes: true, quiet: true }): Command {
    return { optsWithGlobals: () => options, setOptionValueWithSource: vi.fn() } as unknown as Command
  }

  function checkout(): string {
    const root = mkdtempSync(join(tmpdir(), 'portta-reset-'))
    roots.push(root)
    mkdirSync(join(root, 'state/git'), { recursive: true })
    mkdirSync(join(root, 'state/metrics'), { recursive: true })
    writeFileSync(join(root, 'state/git/index.json'), '{}')
    writeFileSync(join(root, 'state/metrics/host.json'), '{}')
    writeFileSync(join(root, '.env.example'), '# Portta environment structure: 1\nPORTTA_AUTH_SECRET=\nPORTTA_RUNTIME_DB_PASSWORD=\n')
    writeFileSync(join(root, '.env'), 'PORTTA_PROFILE=local\n')
    const context = {
      root,
      env: { PORTTA_PROFILE: 'local' } as NodeJS.ProcessEnv,
      config: {
        profile: 'local' as const,
        projectName: 'portta',
        network: 'portta',
        accessNetwork: 'portta-access',
        tcpEnabled: false,
        webEnabled: true,
        webExpose: 'local' as const,
        tlsEnabled: false,
        domain: 'localhost',
        bindAddress: '127.0.0.1',
        webPort: 8787,
      },
      composeFiles: ['docker/compose/compose.yaml'],
      version: 'test',
    }
    mocks.gatewayContext.mockReturnValue(context)
    return root
  }

  function ok() {
    return { stdout: '', stderr: '', exitCode: 0, failed: false }
  }

  it('goes down, removes the panel volume, then runs the checkout setup', async () => {
    const root = checkout()
    const order: string[] = []
    mocks.confirm.mockImplementation(async () => { order.push('confirm') })
    mocks.requireDocker.mockImplementation(async () => { order.push('docker') })
    mocks.removeApplier.mockImplementation(async () => { order.push('applier') })
    mocks.removeRunner.mockImplementation(async () => { order.push('runner') })
    mocks.stopMetricsCollector.mockImplementation(() => { order.push('collector') })
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.prepareWebUp.mockImplementation(() => { order.push('prepare-web'); return {} })
    mocks.finishWebUp.mockImplementation(async () => { order.push('dev-web') })
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
      if (args.includes('down')) order.push('down')
      if (args[0] === 'volume' && args[1] === 'rm') order.push(`volume:${args[2]}`)
      if (args.includes('up')) order.push('up')
      return ok()
    })

    await resetCommand({}, command())

    expect(mocks.confirm).toHaveBeenCalledWith(
      'wipe the panel database and restart this checkout as if it were new?',
      true,
    )
    expect(order.indexOf('confirm')).toBeLessThan(order.indexOf('down'))
    expect(order.indexOf('down')).toBeLessThan(order.indexOf('volume:portta-db'))
    expect(order.indexOf('volume:portta-db')).toBeLessThan(order.indexOf('prepare-web'))
    expect(order.indexOf('prepare-web')).toBeLessThan(order.indexOf('up'))
    expect(order.indexOf('up')).toBeLessThan(order.indexOf('dev-web'))
    expect(order.filter((step) => step === 'up')).toHaveLength(1)
    expect(existsSync(join(root, 'state/git/index.json'))).toBe(false)
    expect(existsSync(join(root, 'state/metrics/host.json'))).toBe(false)
    expect(mocks.applyDemo).not.toHaveBeenCalled()
    expect(mocks.demoStacksDown).not.toHaveBeenCalled()
  })

  it('runs no long docker operation on the dev path with its output swallowed', async () => {
    // The regression this file exists to hold. `portta reset` sat silent for
    // ten minutes because `migrateAuthState` called runProcess directly and
    // got the piped default while carrying `--build`. Anything that builds,
    // pulls or brings containers up is work a person is waiting on, and must
    // reach the terminal.
    checkout()
    mocks.confirm.mockResolvedValue(undefined)
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.prepareWebUp.mockReturnValue({})
    mocks.finishWebUp.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await resetCommand({}, command())

    const LONG = new Set(['build', '--build', 'pull', 'up', 'run'])
    const swallowed = mocks.runProcess.mock.calls
      .filter((call) => {
        const args = (call[1] ?? []) as string[]
        const options = call[2] as { stdio?: string } | undefined
        return call[0] === 'docker' && args.some((argument) => LONG.has(argument)) && (options?.stdio ?? 'pipe') === 'pipe'
      })
      .map((call) => `docker ${((call[1] ?? []) as string[]).join(' ')}`)

    // The list, not a count: when this fails the message is the diagnosis.
    expect(swallowed).toEqual([])
  })

  it('shows the authentication migration, which is the build that used to be invisible', async () => {
    checkout()
    mocks.confirm.mockResolvedValue(undefined)
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.prepareWebUp.mockReturnValue({})
    mocks.finishWebUp.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await resetCommand({}, command())

    const migrate = mocks.runProcess.mock.calls.find((call) => ((call[1] ?? []) as string[]).includes('portta-auth-migrate'))
    expect(migrate).toBeDefined()
    expect(migrate?.[2]).toMatchObject({ stdio: 'inherit' })
  })

  it('treats a missing panel volume as success and applies the demo when asked', async () => {
    checkout()
    mocks.confirm.mockResolvedValue(undefined)
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.removeApplier.mockResolvedValue(undefined)
    mocks.removeRunner.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.prepareWebUp.mockReturnValue({})
    mocks.finishWebUp.mockResolvedValue(undefined)
    mocks.applyDemo.mockResolvedValue(undefined)
    mocks.demoStacksDown.mockResolvedValue(undefined)
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'volume' && args[1] === 'rm') return { stdout: '', stderr: 'Error: no such volume', exitCode: 1, failed: true }
      return ok()
    })

    await resetCommand({ demo: true }, command())

    expect(mocks.demoStacksDown).toHaveBeenCalledTimes(1)
    expect(mocks.applyDemo).toHaveBeenCalledTimes(1)
    expect(mocks.applyDemo).toHaveBeenCalledWith(expect.anything(), { ensurePanel: false })
    expect(mocks.runProcess).toHaveBeenCalledWith('docker', ['volume', 'rm', 'portta-db'], { reject: false })
  })

  it('up --demo applies the demonstration after the gateway is up', async () => {
    checkout()
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.applyDemo.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await upCommand(undefined, { demo: true }, command())

    expect(mocks.applyDemo).toHaveBeenCalledTimes(1)
    expect(mocks.applyDemo).toHaveBeenCalledWith(expect.anything(), { ensurePanel: true })
    const up = mocks.runProcess.mock.calls.find((call) => ((call[1] ?? []) as string[]).includes('up'))
    expect(up?.[1]).toEqual(expect.arrayContaining(['--wait', '--wait-timeout', '180']))
  })

  it('down --demo stops example stacks before the gateway', async () => {
    checkout()
    mocks.removeApplier.mockResolvedValue(undefined)
    mocks.removeRunner.mockResolvedValue(undefined)
    const order: string[] = []
    mocks.demoStacksDown.mockImplementation(async () => { order.push('demo') })
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
      if (args.includes('down')) order.push('gateway')
      return ok()
    })

    await downCommand({ demo: true }, command())

    expect(order).toEqual(['demo', 'gateway'])
  })

  it('down without --demo leaves example stacks alone', async () => {
    checkout()
    mocks.removeApplier.mockResolvedValue(undefined)
    mocks.removeRunner.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await downCommand({}, command())

    expect(mocks.demoStacksDown).not.toHaveBeenCalled()
  })

  it('dev --reset is the same wipe', async () => {
    checkout()
    mocks.confirm.mockResolvedValue(undefined)
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.removeApplier.mockResolvedValue(undefined)
    mocks.removeRunner.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.prepareWebUp.mockReturnValue({})
    mocks.finishWebUp.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await devCommand(undefined, { reset: true }, command())

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.runProcess).toHaveBeenCalledWith('docker', ['volume', 'rm', 'portta-db'], { reject: false })
  })

  it('dev without --reset does not wipe', async () => {
    checkout()
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.prepareWebUp.mockReturnValue({})
    mocks.finishWebUp.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await devCommand(undefined, {}, command())

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.runProcess.mock.calls.some(([, args]) => args[0] === 'volume')).toBe(false)
  })
})
