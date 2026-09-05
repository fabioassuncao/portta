import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// The whole matrix, on the panel that signs people in.
//
// The rules are tested per-service in `packages/server`; what only this can
// prove is that a browser sees them: the page a role does not have is not in
// its navigation, is a 404 when typed, and is a 403 when the same request is
// made by hand from that person's own session. A rule that holds in a unit
// test and not in the panel is not a rule anybody is protected by.
//
// One test, in sequence, for the same reason the sign-in flow is: each account
// exists because the step before it created one.

const PORT = process.env.PORTTA_E2E_PROTECTED_PORT ?? '9914'
const PANEL = `http://127.0.0.1:${PORT}`

const OWNER = { email: 'ada@example.test', password: 'an-end-to-end-password' }
const PASSWORD = 'a-role-suite-password'
const PEOPLE = {
  admin: { name: 'Admin Person', email: 'admin@example.test', role: 'admin' },
  developer: { name: 'Dev Person', email: 'dev@example.test', role: 'developer' },
  viewer: { name: 'View Person', email: 'view@example.test', role: 'viewer' },
} as const

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/overview$/, { timeout: 20_000 })
}

async function signOut(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/sign-in$/, { timeout: 20_000 })
}

/** What the server answers this person, for a request they made themselves. */
async function status(request: APIRequestContext, path: string, init: Parameters<APIRequestContext['fetch']>[1] = {}) {
  const response = await request.fetch(path, init)
  return response.status()
}

test.describe('what each role can reach', () => {
  test.use({ baseURL: PANEL })

  test('an owner makes three roles, and each one sees only its own panel', async ({ page }) => {
    test.slow()
    await signIn(page, OWNER.email, OWNER.password)

    // 1. Three accounts, through the API the Users page uses.
    const ids: Record<string, string> = {}
    for (const person of Object.values(PEOPLE)) {
      const created = await page.request.post('/api/users', {
        data: { ...person, password: PASSWORD },
      })
      expect(created.status(), person.email).toBe(201)
      ids[person.role] = (await created.json()).id as string
    }

    // 2. Two Projects, and one membership each. A developer in `alpha` and a
    //    viewer in `beta` is the shape every negative below is about.
    for (const [slug, name] of [['alpha-roles', 'Alpha'], ['beta-roles', 'Beta']] as const) {
      const created = await page.request.post('/api/projects', { data: { slug, name } })
      expect([201, 409]).toContain(created.status())
    }
    const projects = (await (await page.request.get('/api/projects')).json()) as { projects: { id: string; slug: string }[] }
    const alpha = projects.projects.find((project) => project.slug === 'alpha-roles')!
    const beta = projects.projects.find((project) => project.slug === 'beta-roles')!

    expect((await page.request.put(`/api/users/${ids['developer']}/projects`, {
      data: { projects: [Number(alpha.id)] },
    })).status()).toBe(200)
    expect((await page.request.put(`/api/users/${ids['viewer']}/projects`, {
      data: { projects: [Number(beta.id)] },
    })).status()).toBe(200)

    await signOut(page, 'Ada Lovelace')

    // 3. The administrator: everything but taking the panel.
    await signIn(page, PEOPLE.admin.email, PASSWORD)
    await page.goto('/settings')
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeVisible()
    expect(await status(page.request, '/api/users')).toBe(200)
    // Sees every Project without a membership anywhere.
    const adminProjects = (await (await page.request.get('/api/projects')).json()) as { projects: unknown[] }
    expect(adminProjects.projects.length).toBeGreaterThanOrEqual(2)
    // And cannot act on the owner.
    expect(await status(page.request, `/api/users/${ids['admin']}/role`, {
      method: 'PATCH', data: { role: 'owner' },
    })).toBe(403)
    await signOut(page, PEOPLE.admin.name)

    // 4. The developer: their Project, and nothing about accounts.
    await signIn(page, PEOPLE.developer.email, PASSWORD)
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/settings\/tokens$/, { timeout: 20_000 })
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Audit', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'General', exact: true })).toHaveCount(0)

    // The page a role never has is not part of their panel: 404, not a door.
    await page.goto('/settings/users')
    await expect(page.locator('body')).toContainText(/404|not found|Not Found/i)

    expect(await status(page.request, '/api/users')).toBe(403)
    expect(await status(page.request, '/api/audit')).toBe(403)
    expect(await status(page.request, '/api/config')).toBe(403)

    // Their Project answers; the other one does not exist to them.
    expect(await status(page.request, `/api/projects/${alpha.slug}`)).toBe(200)
    expect(await status(page.request, `/api/projects/${beta.slug}`)).toBe(403)
    // And a listing filters rather than refusing.
    const devProjects = (await (await page.request.get('/api/projects')).json()) as { projects: { slug: string }[] }
    expect(devProjects.projects.map((project) => project.slug)).toEqual([alpha.slug])

    // A developer works, and does not administer.
    expect(await status(page.request, `/api/projects/${alpha.slug}/tasks`, {
      method: 'POST', data: { title: 'a task a developer may create' },
    })).toBe(201)
    expect(await status(page.request, `/api/projects/${alpha.slug}`, { method: 'DELETE' })).toBe(403)
    await signOut(page, PEOPLE.developer.name)

    // 5. The viewer: reads their Project, changes nothing.
    await signIn(page, PEOPLE.viewer.email, PASSWORD)
    expect(await status(page.request, `/api/projects/${beta.slug}`)).toBe(200)
    expect(await status(page.request, `/api/projects/${alpha.slug}`)).toBe(403)
    expect(await status(page.request, `/api/projects/${beta.slug}/tasks`, {
      method: 'POST', data: { title: 'a task a viewer may not create' },
    })).toBe(403)
    expect(await status(page.request, `/api/projects/${beta.slug}`, { method: 'DELETE' })).toBe(403)
    expect(await status(page.request, '/api/users')).toBe(403)

    // The panel does not offer what it would then refuse.
    await page.goto('/projects')
    await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0)

    // A token of their own is theirs to make, and it holds no more than they do.
    const token = await page.request.post('/api/auth/tokens', { data: { name: 'viewer-token', actorKind: 'human' } })
    expect(token.status()).toBe(201)
    const secret = (await token.json()).token as string
    const asToken = await page.request.get('/api/users', { headers: { authorization: `Bearer ${secret}` } })
    expect(asToken.status()).toBe(403)
  })
})
