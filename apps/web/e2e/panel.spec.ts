import { expect, test } from '@playwright/test'

// The panel, driven in a browser against a fake Docker Engine API and a real
// PostgreSQL. What is asserted here is what only a browser can tell you: that
// the shell renders, that the pages are reachable, and that the preferences
// survive a reload.
//
// This covers what exists after the move to Next: the Overview, the
// documentation, and the shell's own controls. The pages for projects, tasks,
// environments and settings come back with the phases that port them, and
// their specs come back with them.

const DOCKER_PORT = process.env.PORTTA_E2E_DOCKER_PORT ?? '9911'

// This panel runs with PORTTA_AUTH_MODE=disabled, which is the documented
// default: on loopback there is nobody to sign in as, and the overview opens
// straight away. `auth.spec.ts` drives the other mode, on its own panel.
test.describe('the panel end to end', () => {
  // Every test describes the same host, whatever the previous one did to it.
  test.beforeEach(async ({ request }) => {
    await request.post(`http://127.0.0.1:${DOCKER_PORT}/__reset`)
  })

  test('opens on the overview and says whether the gateway is healthy', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/overview$/)

    // The route name is the page's h1 for a screen reader; what a person sees
    // at the top is the host, so the heading is asserted present, not visible.
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeAttached()
    await expect(page.getByText('Gateway running')).toBeVisible()
    await expect(page).toHaveTitle('Overview · Portta')
  })

  test('renders the dashboard on the server, before any request from the browser', async ({ page }) => {
    // JavaScript off: what arrives is what the server rendered. A page that
    // needed the client to fetch its own API would be blank here.
    await page.context().addInitScript(() => undefined)
    const response = await page.request.get('/overview')
    const html = await response.text()
    expect(response.status()).toBe(200)
    expect(html).toContain('Needs attention')
  })

  test('serves the documentation from the panel, with its navigation', async ({ page }) => {
    await page.goto('/docs')
    await expect(page.getByRole('link', { name: 'Portta docs' })).toBeVisible()

    await page.getByRole('link', { name: 'Installing and updating', exact: true }).first().click()
    await expect(page).toHaveURL(/\/docs\/install$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Installing and updating' }).first()).toBeVisible()
  })

  test('finds a page by name from the documentation search', async ({ page }) => {
    await page.goto('/docs')
    // The index in docs/README.md is what names a page in the navigation, and
    // the search reads the same list.
    await page.getByRole('searchbox', { name: 'Search the documentation' }).fill('persist')
    await page.getByRole('link', { name: 'Persistence', exact: true }).last().click()
    await expect(page).toHaveURL(/\/docs\/persistence$/)
  })

  test('remembers the theme across a reload', async ({ page }) => {
    await page.goto('/overview')
    await page.getByRole('button', { name: 'Toggle theme' }).click()
    await page.getByRole('menuitemradio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
  })

  test('remembers the language across a reload, and the server renders it', async ({ page }) => {
    await page.goto('/overview')
    await page.getByRole('button', { name: 'Language' }).click()
    await page.getByRole('menuitemradio', { name: 'Português' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')

    // The cookie is the point: the *server* renders the next paint, so the
    // choice has to be somewhere the server can read it.
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
  })

  test('opens the command palette with the keyboard', async ({ page }) => {
    await page.goto('/overview')
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByPlaceholder('Type a command or search…')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByPlaceholder('Type a command or search…')).toBeHidden()
  })

  test('collapses the rail and keeps it collapsed', async ({ page }) => {
    await page.goto('/overview')
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  })

  test('answers the API on the same origin as the pages', async ({ request }) => {
    const health = await request.get('/api/health')
    expect(health.status()).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true })

    // One process, one origin: a session cookie set by the pages is the same
    // cookie the API sees, which is the reason the panel is not two servers.
    const contract = await request.get('/api/openapi.json')
    expect(contract.status()).toBe(200)
  })

  // Set in `next.config.ts`, and only a real response proves they arrive: the
  // panel can start, stop and remove containers, so nothing may frame it and
  // nothing may guess at a response's type.
  test('carries its security headers on a page', async ({ request }) => {
    const response = await request.get('/overview')
    const headers = response.headers()
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('no-referrer')
  })

  test('and never lets the API be cached', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.headers()['cache-control']).toContain('no-store')
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
  })

  test('refuses a /ws path no route claims, rather than leaving the socket open', async ({ request }) => {
    const response = await request.get('/ws/nothing/here', {
      headers: { connection: 'Upgrade', upgrade: 'websocket' },
    })
    expect(response.status()).toBe(404)
  })

  test('streams an environment log over a websocket', async ({ page }) => {
    await page.goto('/overview')
    // From the page, so the handshake carries whatever a browser would carry.
    const received = await page.evaluate(async () => {
      const socket = new WebSocket(`ws://${location.host}/ws/environments/alpha/logs?service=web&tail=10`)
      return await new Promise<string[]>((resolve, reject) => {
        const messages: string[] = []
        socket.onmessage = (event) => {
          messages.push(String(event.data))
          if (messages.length >= 1) {
            socket.close()
            resolve(messages)
          }
        }
        socket.onerror = () => reject(new Error('the socket refused the handshake'))
        setTimeout(() => resolve(messages), 5_000)
      })
    })
    expect(received.length).toBeGreaterThan(0)
    expect(JSON.parse(received[0]!)).toMatchObject({ kind: 'open', environment: 'alpha' })
  })
})
