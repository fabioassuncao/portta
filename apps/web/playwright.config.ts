import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORTTA_E2E_PANEL_PORT ?? 9912)
// A second panel, on its own port and its own database, started with
// PORTTA_AUTH_MODE=required. The sign-in flow cannot be exercised on the first
// one: a panel is in one mode or the other for its whole life.
const PROTECTED_PORT = Number(process.env.PORTTA_E2E_PROTECTED_PORT ?? 9914)

// The end-to-end run drives the real panel against a fake Docker Engine API, so
// it describes a known host. It does need a Docker daemon, but only to start a
// PostgreSQL: the database is a boot dependency of the panel, and the harness
// starts and removes a disposable one. Point PORTTA_E2E_DATABASE_URL at your
// own to skip that.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run build && node e2e/harness.mjs',
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      // The build the first one runs is the same build, so this waits for it
      // rather than repeating it.
      command: 'node e2e/wait-for-build.mjs && node e2e/harness.mjs',
      url: `http://127.0.0.1:${PROTECTED_PORT}/api/health`,
      // Never reused, unlike the open panel: creating the owner happens once in
      // a panel's life, so this one has to start from an empty database every
      // run or the flow it exists to test has already happened.
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      env: {
        PORTTA_E2E_AUTH_MODE: 'required',
        PORTTA_E2E_PANEL_PORT: String(PROTECTED_PORT),
        PORTTA_E2E_DOCKER_PORT: String(Number(process.env.PORTTA_E2E_DOCKER_PORT ?? 9911) + 10),
        PORTTA_E2E_DATABASE_NAME: 'portta_protected',
      },
    },
  ],
})

export const PROTECTED_URL = `http://127.0.0.1:${PROTECTED_PORT}`
