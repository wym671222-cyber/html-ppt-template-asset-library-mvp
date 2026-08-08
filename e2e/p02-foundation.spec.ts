import { expect, test } from '@playwright/test'

test('P02 loopback and fixed Owner defenses remain active in the P06 product root', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '模板资产库' })).toBeVisible()

  const apiUrl = process.env.P02_API_URL ?? 'http://127.0.0.1:3017'
  const owner = await request.get(`${apiUrl}/api/owner`, { headers: { origin: 'http://127.0.0.1:5173' } })
  expect(owner.ok()).toBeTruthy()
  await expect(owner.json()).resolves.toEqual({ owner: { id: 'local-owner', kind: 'local' } })

  const legacyRoute = await request.get(`${apiUrl}/api/auth/login`)
  expect(legacyRoute.status()).toBe(404)
})
