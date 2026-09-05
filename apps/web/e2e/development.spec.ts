import { expect, test } from '@playwright/test'

// The development pages, end to end: a Project is created, a task is created in
// it, moved on the board, opened, and the Project's repositories tab answers.
//
// One test, in order, because each step is the previous one's state. Splitting
// them would mean either repeating the setup four times or depending on the
// order anyway while pretending not to.

// The open panel keeps its database between runs, so the Project this test
// creates carries the run in its name rather than colliding with itself.
const RUN = String(Date.now()).slice(-6)
const NAME = `E2E ${RUN}`
const SLUG = `e2e-${RUN}`

test.describe('the development pages', () => {
  test('creates a Project, then a task in it, and moves it on the board', async ({ page }) => {
    await page.goto('/projects')
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeAttached()

    // 1. A Project. The empty state offers the same button, so this is the one
    // in the page header.
    await page.locator('header').getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name', { exact: true }).fill(NAME)
    await dialog.getByLabel('Slug').fill(SLUG)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`/projects/${SLUG}$`), { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: NAME })).toBeVisible()

    // 2. Its tabs are routes, not state.
    await page.getByRole('tab', { name: 'Repositories (0)' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${SLUG}/repositories$`))
    await expect(page.getByRole('button', { name: /Add repository/ })).toBeVisible()

    // 3. A task, created from the Project header, which opens its draft.
    await page.getByRole('button', { name: 'New task' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${SLUG}/tasks/\\d+`), { timeout: 20_000 })
    await page.getByRole('textbox', { name: 'Title' }).fill('Ship the thing')
    // Blurring is what saves it, and the save is a request. Waiting for the
    // response rather than for the blur: navigating first left the board
    // looking for a title the panel had not been told about yet.
    const saved = page.waitForResponse(
      (response) => response.request().method() === 'PATCH'
        && /\/api\/tasks\/\d+$/.test(new URL(response.url()).pathname)
        && response.ok(),
      { timeout: 20_000 },
    )
    await page.getByRole('textbox', { name: 'Title' }).blur()
    await saved

    // 4. The board has it, and the filters are in the URL.
    await page.goto(`/projects/${SLUG}/tasks`)
    await expect(page.getByRole('article', { name: /Ship the thing/ })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('radio', { name: 'Table' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${SLUG}/tasks\\?view=table`))

    // 5. And the global list shows it under its Project.
    await page.goto('/tasks')
    await expect(page.getByRole('link', { name: NAME }).first()).toBeVisible({ timeout: 20_000 })
  })

  test('answers 404 for a Project that does not exist', async ({ page }) => {
    const response = await page.goto('/projects/nothing-here')
    expect(response?.status()).toBe(404)
  })
})
