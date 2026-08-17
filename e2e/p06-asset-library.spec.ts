import { expect, test } from '@playwright/test'

const apiUrl = process.env.P06_API_URL ?? 'http://127.0.0.1:3018'

test('P04A three-column catalog opens a real static runtime and restores preview focus', async ({ page, request }) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(request.url())
  })
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
  const runtimeFrame = page.locator('iframe[title="Simulated Quarterly Brief 的隔离静态预览"]')
  await expect(runtimeFrame).toBeVisible()
  await expect(runtimeFrame).toHaveAttribute('sandbox', '')
  await expect(page.getByText('页面已就绪')).toBeVisible()
  await expect(runtimeFrame.contentFrame().getByRole('heading', { name: 'Quarterly brief title' })).toBeVisible()
  await expect(runtimeFrame.contentFrame().locator('script')).toHaveCount(0)
  await expect(page.locator('details.metadata-panel')).not.toHaveAttribute('open')
  expect(externalRequests).toEqual([])
  await page.getByRole('button', { name: '关闭模板预览' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '预览 Simulated Quarterly Brief' })).toBeFocused()

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

test('P04A v2 modal exposes replay/reset, fit, fullscreen and two-step Escape', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('searchbox', { name: '搜索模板名称、分类或标签' }).fill('动态标题导演')
  const previewButton = page.getByRole('button', { name: '预览 动态标题导演' })
  await expect(previewButton).toBeVisible()
  await previewButton.click()

  const runtimeFrame = page.locator('iframe[title="动态标题导演 的隔离交互预览"]')
  await expect(runtimeFrame).toBeVisible()
  await expect(runtimeFrame).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(page.getByText('页面已就绪')).toBeVisible({ timeout: 15_000 })
  const templateFrame = runtimeFrame.contentFrame().locator('iframe[name="ppt-template-document"]').contentFrame()
  await expect(templateFrame.locator('#stage')).toBeVisible()

  await page.getByRole('button', { name: '重播' }).click()
  await expect.poll(() => templateFrame.locator('html').getAttribute('data-ppt-runtime-last-command')).toBe('replay:1')
  await page.getByRole('button', { name: '重置' }).click()
  await expect.poll(() => templateFrame.locator('html').getAttribute('data-ppt-runtime-last-command')).toBe('reset:2')

  const fit = page.getByRole('button', { name: '适应窗口' })
  await expect(fit).toHaveAttribute('aria-pressed', 'true')
  await fit.click()
  await expect(fit).toHaveAttribute('aria-pressed', 'false')
  await fit.click()

  await page.getByRole('button', { name: '全屏预览' }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
  await expect(page.getByRole('button', { name: '退出全屏' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(previewButton).toBeFocused()
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`P04A ${viewport.width}x${viewport.height} keeps the three columns and two-card grid visible`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByRole('complementary', { name: '资产筛选' })).toBeVisible()
    await expect(page.locator('.asset-grid')).toBeVisible()
    await expect(page.getByRole('heading', { name: /已选汇报/ })).toBeVisible()
    expect(await page.locator('.workspace').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(3)
    expect(await page.locator('.asset-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

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
