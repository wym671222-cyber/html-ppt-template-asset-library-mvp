import { expect, test } from '@playwright/test'

const apiUrl = process.env.P06_API_URL ?? 'http://127.0.0.1:3018'

test('P06 three-column catalog supports search, filters, safe selection and PNG detail', async ({ page, request }) => {
  const catalogResponse = await request.get('/api/catalog')
  expect(catalogResponse.ok()).toBeTruthy()
  expect(await catalogResponse.json()).not.toHaveProperty('owner')
  await page.route('**/api/catalog*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350))
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'HTML 汇报模板资产库首页' })).toBeVisible()
  await expect(page.getByRole('status', { name: '模板加载中' })).toBeVisible()

  const card = page.getByRole('button', { name: '加入汇报：Simulated Quarterly Brief' })
  await expect(card).toBeVisible()
  await page.getByRole('button', { name: '预览 Simulated Quarterly Brief' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const preview = page.getByAltText('Simulated Quarterly Brief 的安全 PNG 预览')
  await expect(preview).toBeVisible()
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([1280, 720])
  expect(await page.locator('iframe, [srcdoc]').count()).toBe(0)
  await page.getByRole('button', { name: '关闭模板详情' }).click()

  await page.keyboard.press('Tab')
  await card.focus()
  await expect(card).toBeFocused()
  expect(await card.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  expect(await card.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')

  const search = page.getByRole('searchbox', { name: '搜索模板名称、分类或标签' })
  await search.fill('missing')
  await expect(page.getByRole('heading', { name: '没有匹配的模板' })).toBeVisible()
  await search.fill('')
  await expect(card).toBeVisible()

  await page.getByRole('checkbox', { name: /brief/ }).check()
  await expect(card).toBeVisible()
  await page.getByRole('radio', { name: /report\/quarterly/ }).check()
  await expect(card).toBeVisible()
  await page.getByRole('button', { name: '清空' }).first().click()
  await expect(page.getByRole('checkbox', { name: /brief/ })).not.toBeChecked()
  await expect(page.getByRole('radio', { name: /report\/quarterly/ })).not.toBeChecked()
})

test('asset theme defaults to system, supports keyboard, persists manual choice and follows live system changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.asset-grid')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-asset-theme-choice', 'system')
  await expect(page.locator('html')).toHaveAttribute('data-asset-theme', 'dark')
  const trigger = page.getByRole('button', { name: /跟随系统/ })
  await trigger.focus()
  await trigger.press('Enter')
  const darkOption = page.getByRole('menuitemradio', { name: '深色' })
  await expect(darkOption).toBeFocused()
  await darkOption.press('ArrowDown')
  await expect(page.getByRole('menuitemradio', { name: '浅色' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()

  await trigger.click()
  await page.getByRole('menuitemradio', { name: '浅色' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-asset-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-asset-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-asset-theme-choice', 'light')

  await page.getByRole('button', { name: /浅色/ }).click()
  await page.getByRole('menuitemradio', { name: '跟随系统' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-asset-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-asset-theme', 'light')
})

test('P06 catalog exposes a clear error state and recovers', async ({ page }) => {
  let failed = false
  await page.route('**/api/catalog*', async (route) => {
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
  await expect(page.getByRole('button', { name: '加入汇报：Simulated Quarterly Brief' })).toBeVisible()
})

test('administrator can select and import self-contained HTML while active HTML is rejected', async ({ page }) => {
  await page.goto('/admin#template-import')
  const fileInput = page.locator('#template-import input[type="file"]')
  await expect(fileInput).toHaveAttribute('accept', /\.html,\.htm/)
  await fileInput.setInputFiles({ name: 'safe-template.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><html><head><style>body{margin:0;background:#102033;color:white}</style></head><body><h1>HTML E2E 模板</h1></body></html>') })
  await page.getByLabel('模板标题').fill('HTML E2E 模板')
  await page.getByLabel('摘要').fill('仅使用仓库内隔离测试数据的自包含模板')
  await page.getByLabel('标签').fill('E2E，安全导入')
  await page.getByRole('button', { name: '校验并导入' }).click()
  await expect(page.getByText(/已进入目录/)).toBeVisible({ timeout: 45_000 })
  await page.getByRole('link', { name: '返回资产库查看' }).click()
  await page.getByRole('searchbox').fill('HTML E2E 模板')
  await expect(page.getByRole('button', { name: '加入汇报：HTML E2E 模板' })).toBeVisible()

  await page.goto('/admin#template-import')
  await page.locator('#template-import input[type="file"]').setInputFiles({ name: 'active.htm', mimeType: 'text/html', buffer: Buffer.from('<html><body><script>alert(1)</script></body></html>') })
  await page.getByLabel('模板标题').fill('应被拒绝的模板')
  await page.getByLabel('摘要').fill('用于验证主动内容拒绝')
  await page.getByRole('button', { name: '校验并导入' }).click()
  await expect(page.getByRole('alert')).toContainText(/script|active/i)
  await page.getByRole('tab', { name: 'ZIP 包' }).click()
  await expect(page.locator('#template-import input[type="file"]')).toHaveAttribute('accept', /\.zip/)
})

test('P06 responsive layout uses a filter drawer and vertical cart without horizontal overflow', async ({ page, request }) => {
  await page.setViewportSize({ width: 680, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '加入汇报：Simulated Quarterly Brief' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /已选汇报/ })).toBeVisible()
  await page.getByRole('button', { name: '筛选', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '资产筛选' })).toBeVisible()
  await page.getByRole('button', { name: '关闭筛选' }).first().click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const login = await request.get('http://127.0.0.1:5175/login')
  expect(login.status()).toBe(200)
  expect(await login.text()).toContain('模板资产库')
  for (const path of ['/api/providers', '/api/preview', '/api/export']) expect((await request.get(`http://127.0.0.1:5175${path}`)).status()).toBe(404)
  expect((await request.get(`${apiUrl}/api/catalog`, { headers: { host: 'example.test' } })).status()).toBe(421)
  expect((await request.get(`${apiUrl}/api/catalog`, { headers: { origin: 'https://example.test' } })).status()).toBe(403)
})
