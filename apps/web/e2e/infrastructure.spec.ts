import { expect, test } from '@playwright/test'

// The infrastructure pages, against the fake Docker host the harness describes.
test.describe('the infrastructure pages', () => {
  test('lists the environments and opens one on its own tabs', async ({ page }) => {
    await page.goto('/environments')
    await expect(page.getByRole('heading', { name: 'Environments', level: 1 })).toBeAttached()
    await page.getByRole('link', { name: 'alpha', exact: true }).first().click()

    await expect(page).toHaveURL(/\/environments\/alpha$/)
    await expect(page.getByRole('row', { name: 'web service' })).toBeVisible()

    await page.getByRole('tab', { name: 'Logs' }).click()
    await expect(page).toHaveURL(/\/environments\/alpha\/logs$/)
    await expect(page.getByLabel('Service')).toBeVisible()

    await page.getByRole('tab', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/environments\/alpha\/settings$/)
    await expect(page.getByLabel('Display name')).toBeVisible()
  })

  test('answers on Services, Docker, Network, Access and Gateway', async ({ page }) => {
    for (const [path, heading] of [
      ['/services', 'Services'],
      ['/docker', 'Docker'],
      ['/network', 'Network'],
      ['/access', 'Access'],
      ['/gateway', 'Gateway'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeAttached()
    }
  })

  test('starts and stops an environment through the panel', async ({ page, request }) => {
    const dockerPort = process.env.PORTTA_E2E_DOCKER_PORT ?? '9911'
    await request.post(`http://127.0.0.1:${dockerPort}/__reset`)

    await page.goto('/environments/alpha')
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    // Stopping says what it interrupts before it does it.
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled({ timeout: 20_000 })
  })
})
