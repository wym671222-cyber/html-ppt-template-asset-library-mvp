import { expect, test } from '@playwright/test'

test('P02 web foundation and API only expose the loopback product root', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '本机单 Owner 基础已启用' })).toBeVisible()

  const apiUrl = process.env.P02_API_URL ?? 'http://127.0.0.1:3017'
  const owner = await request.get(`${apiUrl}/api/owner`, { headers: { origin: 'http://127.0.0.1:5173' } })
  expect(owner.ok()).toBeTruthy()
  await expect(owner.json()).resolves.toEqual({ owner: { id: 'local-owner', kind: 'local' } })

  const legacyRoute = await request.get(`${apiUrl}/api/auth/login`)
  expect(legacyRoute.status()).toBe(404)
})
