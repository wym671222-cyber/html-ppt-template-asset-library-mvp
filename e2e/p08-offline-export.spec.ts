import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readStoredZip } from '../apps/api/src/presentation-exports/offline-archive.js'

async function resetPresentation(page: import('@playwright/test').Page, addTemplate: boolean): Promise<void> {
  await page.goto('/')
  const cart = page.locator('.cart-panel')
  await expect(cart).toHaveAttribute('aria-busy', 'false')
  const create = page.getByRole('button', { name: '创建汇报' })
  if (await create.isVisible().catch(() => false)) {
    await page.getByLabel('汇报名称').fill('P08 导出闭环')
    await create.click()
    await expect(page.getByText('已创建汇报。')).toBeVisible()
  }
  const reportName = page.getByLabel('汇报名称')
  if (await reportName.inputValue() !== 'P08 导出闭环') {
    await reportName.fill('P08 导出闭环')
    await reportName.press('Tab')
    await expect(page.getByText('汇报名称已更新。')).toBeVisible()
  }
  const clear = cart.locator(':scope > footer').getByRole('button', { name: '清空' })
  if (await clear.isEnabled()) {
    await clear.click()
    await expect(page.locator('.cart-list li')).toHaveCount(0)
  }
  if (addTemplate) {
    await page.getByRole('button', { name: '加入汇报：Simulated Quarterly Brief' }).click()
    await expect(page.locator('.cart-list li')).toHaveCount(1)
  }
}

test('P08 exposes keyboard-accessible empty, loading, success and HTML/ZIP artifact states', async ({ page, request }) => {
  await resetPresentation(page, false)
  const createExport = page.getByRole('button', { name: /HTML \/ ZIP/ })
  await expect(createExport).toBeDisabled()
  await page.getByRole('button', { name: '加入汇报：Simulated Quarterly Brief' }).click()

  await page.route('**/api/presentations/*/exports', async (route) => {
    if (route.request().method() === 'POST') await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
    await route.continue()
  })
  await expect(createExport).toBeEnabled()
  await createExport.focus()
  await createExport.press('Enter')
  await expect(page.getByRole('button', { name: '正在生成…' })).toBeDisabled()
  const notice = page.getByText(/已生成离线 HTML\/ZIP/)
  await expect(notice).toBeVisible()
  await expect(notice).toBeFocused()

  const htmlLink = page.getByRole('link', { name: 'HTML' }).first()
  const zipLink = page.getByRole('link', { name: 'ZIP' }).first()
  await expect(htmlLink).toBeVisible()
  await expect(zipLink).toBeVisible()
  expect((await request.get(await htmlLink.getAttribute('href') ?? '')).headers()['content-type']).toContain('text/html')
  expect((await request.get(await zipLink.getAttribute('href') ?? '')).headers()['content-type']).toBe('application/zip')
  expect(await page.locator('iframe, [srcdoc]').count()).toBe(0)
})

test('P08 reloads a stale revision conflict and stays usable at 680px', async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 900 })
  await resetPresentation(page, true)
  await page.route('**/api/presentations/*/exports', async (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Presentation has changed; reload and retry' }) })
    return route.continue()
  })
  await page.getByRole('button', { name: /HTML \/ ZIP/ }).click()
  const notice = page.getByText('检测到较新 revision，已重新加载；请确认项目后再导出。')
  await expect(notice).toBeVisible()
  await expect(notice).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('P08 ZIP opens offline using only controlled extracted files with no cookie or active content', async ({ page, request }) => {
  await resetPresentation(page, true)
  await page.getByRole('button', { name: /HTML \/ ZIP/ }).click()
  await expect(page.getByText(/已生成离线 HTML\/ZIP/)).toBeVisible()
  const zipUrl = await page.getByRole('link', { name: 'ZIP' }).first().getAttribute('href')
  const response = await request.get(zipUrl ?? '')
  expect(response.ok()).toBeTruthy()
  const entries = readStoredZip(Buffer.from(await response.body()))
  const exportRoot = mkdtempSync(`${tmpdir()}/asset-library-p08-offline-`)
  try {
    for (const [entry, content] of entries) {
      const destination = resolve(exportRoot, entry)
      const fromRoot = relative(exportRoot, destination)
      expect(fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`)).toBe(true)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, content, { flag: 'wx' })
    }
    const requests: string[] = []
    page.on('request', (networkRequest) => requests.push(networkRequest.url()))
    await page.context().setOffline(true)
    await page.goto(pathToFileURL(resolve(exportRoot, 'index.html')).href)
    await expect(page.getByRole('heading', { name: 'P08 导出闭环' })).toBeVisible()
    await expect(page.getByRole('link', { name: '1 Simulated Quarterly Brief' })).toBeVisible()
    expect(await page.locator('script, frame, object, embed, form').count()).toBe(0)
    expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(1)
    const slide = page.frameLocator('iframe[sandbox="allow-scripts"]').first()
    await expect(slide.getByRole('heading', { name: 'Quarterly brief title' })).toBeVisible()
    expect(await slide.locator('script, iframe, frame, object, embed, form').count()).toBe(0)
    expect(await page.evaluate(() => { try { return document.cookie } catch { return '' } })).toBe('')
    expect(requests.some((url) => /^https?:/i.test(url))).toBe(false)
    for (const url of requests) {
      expect(url.startsWith('file:')).toBe(true)
      const decoded = decodeURIComponent(new URL(url).pathname)
      const fromRoot = relative(exportRoot, decoded)
      expect(fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`)).toBe(true)
    }
  } finally { rmSync(exportRoot, { recursive: true, force: true }) }
})
