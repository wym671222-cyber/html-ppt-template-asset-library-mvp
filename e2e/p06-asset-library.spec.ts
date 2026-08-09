import { expect, test } from '@playwright/test'

const apiUrl = process.env.P06_API_URL ?? 'http://127.0.0.1:3018'

test('P06 three-column catalog supports search, filters, selection, keyboard focus and safe PNG detail', async ({ page, request }) => {
  const catalogResponse = await request.get('/api/catalog')
  expect(catalogResponse.ok()).toBeTruthy()
  expect(await catalogResponse.json()).not.toHaveProperty('owner')
  await page.route('**/api/catalog', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350))
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '模板资产库' })).toBeVisible()
  await expect(page.getByRole('status', { name: '模板加载中' })).toBeVisible()

  const card = page.getByRole('button', { name: '选择模板 Simulated Quarterly Brief' })
  await expect(card).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Simulated Quarterly Brief', level: 2 })).toBeVisible()
  const preview = page.getByAltText('Simulated Quarterly Brief 的安全 PNG 预览')
  await expect(preview).toBeVisible()
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([1280, 720])
  expect(await page.locator('iframe, [srcdoc]').count()).toBe(0)

  await card.focus()
  await card.press('ArrowDown')
  await expect(card).toBeFocused()
  expect(await card.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')

  const search = page.getByRole('searchbox', { name: '搜索模板' })
  await search.fill('missing')
  await expect(page.getByRole('heading', { name: '没有匹配的模板' })).toBeVisible()
  await search.press('Escape')
  await expect(card).toBeVisible()

  await page.getByRole('checkbox', { name: 'brief' }).check()
  await expect(card).toBeVisible()
  await page.getByRole('radio', { name: 'report/quarterly' }).check()
  await expect(card).toBeVisible()
  await page.getByRole('button', { name: '重置筛选' }).click()
  await expect(page.getByRole('radio', { name: '全部' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'brief' })).not.toBeChecked()
})

test('P06 catalog exposes a clear error state and recovers', async ({ page }) => {
  let failed = false
  await page.route('**/api/catalog', async (route) => {
    if (!failed) {
      failed = true
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: '模拟本机目录不可用' }) })
      return
    }
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '无法加载资产目录' })).toBeVisible()
  await expect(page.getByText('模拟本机目录不可用')).toBeVisible()
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.getByRole('button', { name: '选择模板 Simulated Quarterly Brief' })).toBeVisible()
})

test('P06 responsive layout remains usable and old or online routes stay unreachable', async ({ page, request }) => {
  await page.setViewportSize({ width: 680, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '选择模板 Simulated Quarterly Brief' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: '所选模板详情' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  for (const path of ['/login', '/api/providers', '/api/preview', '/api/export']) {
    const response = await request.get(`http://127.0.0.1:5175${path}`)
    expect(response.status()).toBe(404)
  }
  expect((await request.get(`${apiUrl}/api/catalog`, { headers: { host: 'example.test' } })).status()).toBe(421)
  expect((await request.get(`${apiUrl}/api/catalog`, { headers: { origin: 'https://example.test' } })).status()).toBe(403)
  expect((await request.get(`${apiUrl}/api/auth/login`)).status()).toBe(404)
})
