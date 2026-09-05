import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// Administration, against the second panel: the one started with
// PORTTA_AUTH_MODE=required, whose owner `auth.spec.ts` created.
//
// One test, in sequence, for the same reason the sign-in flow is one: an
// account exists because the step before it created it, and a viewer cannot
// sign in until an administrator has made them.

const PORT = process.env.PORTTA_E2E_PROTECTED_PORT ?? '9914'
const PANEL = `http://127.0.0.1:${PORT}`
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CLI = `${ROOT}packages/cli/dist/cli.js`

const OWNER = { email: 'ada@example.test', password: 'an-end-to-end-password' }
const VIEWER = { name: 'Rita Levi', email: 'rita@example.test', password: 'another-end-to-end-password' }

async function signIn(page: import('@playwright/test').Page, who: { email: string; password: string }) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password').fill(who.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/overview$/, { timeout: 20_000 })
}

test.describe('administering a panel that asks who you are', () => {
  test.use({ baseURL: PANEL })

  test('an owner makes a viewer, who sees their own tokens and nothing else', async ({ page }) => {
    test.slow()
    await signIn(page, OWNER)

    // 1. Settings opens on the first section the owner has.
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/settings\/general\//, { timeout: 20_000 })
    for (const section of ['General', 'Users', 'API tokens', 'Security', 'Integrations', 'Audit']) {
      await expect(page.getByRole('link', { name: section, exact: true })).toBeVisible()
    }

    // 2. The owner creates a viewer.
    await page.getByRole('link', { name: 'Users', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'New user' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel(/^Name/).fill(VIEWER.name)
    await form.getByLabel(/^Email/).fill(VIEWER.email)
    await form.getByLabel(/^Password/).fill(VIEWER.password)
    await form.getByRole('button', { name: 'New user' }).click()
    await expect(page.getByText(VIEWER.email)).toBeVisible({ timeout: 20_000 })

    // 3. The owner signs out and the viewer signs in.
    // Exact: the row's own menu is "Actions for Ada Lovelace".
    await page.getByRole('button', { name: 'Ada Lovelace', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/sign-in$/, { timeout: 20_000 })
    await signIn(page, VIEWER)

    // 4. Settings is a different place for them: no Users, no Audit, no
    //    General, and the landing section is the first one they hold.
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/settings\/tokens$/, { timeout: 20_000 })
    await expect(page.getByRole('link', { name: 'API tokens', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Security', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Audit', exact: true })).toHaveCount(0)

    // A page a role never has is not part of their panel.
    const refused = await page.request.get('/api/users')
    expect(refused.status()).toBe(403)

    // 5. They make a token, and it is shown exactly once.
    await page.getByRole('button', { name: 'New token' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Name/).fill('laptop')
    await dialog.getByRole('button', { name: 'New token' }).click()
    const secret = (await page.getByRole('dialog').locator('pre').innerText()).trim()
    expect(secret.startsWith('ptt_')).toBe(true)
    await page.getByRole('button', { name: 'I copied it' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('table').getByText('laptop', { exact: true })).toBeVisible()

    // 6. And the CLI signs in with it, as them.
    if (!existsSync(CLI)) {
      execFileSync('npm', ['run', 'build', '--workspace=portta'], { cwd: ROOT, stdio: 'inherit' })
    }
    const output = execFileSync('node', [CLI, 'auth', 'token', 'list', '--url', PANEL, '--json'], {
      env: { ...process.env, PORTTA_TOKEN: secret },
      encoding: 'utf8',
    })
    const listed = JSON.parse(output) as { tokens: { name: string; user: string }[] }
    expect(listed.tokens).toHaveLength(1)
    expect(listed.tokens[0]).toMatchObject({ name: 'laptop', user: VIEWER.email })
  })
})
