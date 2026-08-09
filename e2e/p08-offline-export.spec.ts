import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readStoredZip } from '../apps/api/src/presentation-exports/offline-archive.js'

async function resetPresentation(page: import('@playwright/test').Page, name: string, addTemplate: boolean): Promise<void> {
  await page.goto('/')
  await expect(page.locator('.presentation-panel')).toHaveAttribute('aria-busy', 'false')
  const newName = page.getByLabel('新汇报名称')
  if (await newName.isVisible().catch(() => false)) {
    await newName.fill(name)
    await page.getByRole('button', { name: '创建汇报' }).click()
    await expect(page.getByText('已创建本机汇报。')).toBeVisible()
  } else {
    await page.getByLabel('名称', { exact: true }).fill(name)
    await page.getByRole('button', { name: '重命名' }).click()
    await expect(page.getByText('名称已更新。')).toBeVisible()
  }
  const deleteButtons = page.getByRole('button', { name: '删除' })
  while (await deleteButtons.count()) {
    const count = await deleteButtons.count()
    await deleteButtons.first().click()
    await expect(deleteButtons).toHaveCount(count - 1)
  }
  if (addTemplate) {
    await page.getByRole('button', { name: '加入所选模板' }).click()
    await expect(page.getByText('1. Simulated Quarterly Brief')).toBeVisible()
  }
}

test('P08 exposes keyboard-accessible loading, empty, success and audited artifact states', async ({ page, request }) => {
  await resetPresentation(page, 'P08 导出闭环', false)
  await expect(page.getByText('暂无导出。加入至少一个模板后，可生成完全离线的 HTML/ZIP。')).toBeVisible()
  await expect(page.getByRole('button', { name: '生成 HTML/ZIP' })).toBeDisabled()
  await page.getByRole('button', { name: '加入所选模板' }).click()

  await page.route('**/api/presentations/*/exports', async (route) => {
    if (route.request().method() === 'POST') await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
    await route.continue()
  })
  const createExport = page.getByRole('button', { name: '生成 HTML/ZIP' })
  await expect(createExport).toBeEnabled()
  await createExport.focus()
  await expect(createExport).toBeFocused()
  await createExport.press('Enter')
  await expect(page.getByRole('button', { name: '正在生成…' })).toBeDisabled()
  const notice = page.getByText(/已生成离线 HTML\/ZIP/)
  await expect(notice).toBeVisible()
  await expect(notice).toBeFocused()

  const manifestLink = page.getByRole('link', { name: 'Manifest' }).first()
  const htmlLink = page.getByRole('link', { name: 'HTML' }).first()
  const zipLink = page.getByRole('link', { name: 'ZIP' }).first()
  for (const link of [manifestLink, htmlLink, zipLink]) await expect(link).toBeVisible()
  const manifestResponse = await request.get(await manifestLink.getAttribute('href') ?? '')
  expect(manifestResponse.ok()).toBeTruthy()
  const manifest = await manifestResponse.json() as { manifest: { contractVersion: string; package: { files: Array<{ relativePath: string; sha256: string }> } } }
  expect(manifest.manifest.contractVersion).toBe('html-presentation-export/v2')
  expect(manifest.manifest.package.files.map((file) => file.relativePath)).toEqual(['index.html', 'assets/slide-0001-thumbnail.png', 'manifest.json'])
  expect(manifest.manifest.package.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true)
  expect((await request.get(await htmlLink.getAttribute('href') ?? '')).headers()['content-type']).toContain('text/html')
  expect((await request.get(await zipLink.getAttribute('href') ?? '')).headers()['content-type']).toBe('application/zip')
  expect(await page.locator('iframe, [srcdoc]').count()).toBe(0)
})

test('P08 reloads a stale revision conflict and stays usable at 680px', async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 900 })
  await resetPresentation(page, 'P08 冲突恢复', true)
  await page.route('**/api/presentations/*/exports', async (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Presentation has changed; reload and retry' }) })
    return route.continue()
  })
  await page.getByRole('button', { name: '生成 HTML/ZIP' }).click()
  const notice = page.getByText('检测到较新 revision，已重新加载；请确认项目后再导出。')
  await expect(notice).toBeVisible()
  await expect(notice).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('P08 ZIP opens offline using only controlled extracted files with no cookie or active content', async ({ page, request }) => {
  await resetPresentation(page, 'P08 离线打开', true)
  await page.getByRole('button', { name: '生成 HTML/ZIP' }).click()
  await expect(page.getByText(/已生成离线 HTML\/ZIP/)).toBeVisible()
  const zipUrl = await page.getByRole('link', { name: 'ZIP' }).first().getAttribute('href')
  const response = await request.get(zipUrl ?? '')
  expect(response.ok()).toBeTruthy()
  const entries = readStoredZip(Buffer.from(await response.body()))
  const exportRoot = mkdtempSync(join(tmpdir(), 'asset-library-p08-offline-'))
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
    await expect(page.getByRole('heading', { name: 'P08 离线打开' })).toBeVisible()
    await expect(page.getByRole('link', { name: '1 Simulated Quarterly Brief' })).toBeVisible()
    expect(await page.locator('script, iframe, frame, object, embed, form').count()).toBe(0)
    expect(await page.evaluate(() => { try { return document.cookie } catch { return '' } })).toBe('')
    expect(requests.some((url) => /^https?:/i.test(url))).toBe(false)
    for (const url of requests) {
      expect(url.startsWith('file:')).toBe(true)
      const path = new URL(url).pathname
      const decoded = decodeURIComponent(path)
      const fromRoot = relative(exportRoot, decoded)
      expect(fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`)).toBe(true)
    }
  } finally {
    rmSync(exportRoot, { recursive: true, force: true })
  }
})
