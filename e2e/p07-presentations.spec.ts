import { expect, test } from '@playwright/test'

test('P07 creates a report, adds fixed template versions, reorders and removes them with keyboard-accessible controls', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /已选汇报/ })).toBeVisible()
  await page.getByLabel('汇报名称').fill('P07 本机汇报')
  await page.getByRole('button', { name: '创建汇报' }).click()
  await expect(page.getByText('已创建汇报。')).toBeVisible()

  const first = page.getByRole('button', { name: '加入汇报：Simulated Quarterly Brief' })
  await first.focus()
  await expect(first).toBeFocused()
  await first.press('Enter')
  await page.getByRole('button', { name: '加入汇报：季度经营复盘' }).click()
  await expect(page.locator('.cart-list li')).toHaveCount(2)

  await page.getByRole('button', { name: '下移 Simulated Quarterly Brief' }).click()
  await expect(page.getByText('排序已更新。')).toBeVisible()
  await page.getByRole('button', { name: '移除 Simulated Quarterly Brief' }).click()
  await expect(page.locator('.cart-list li')).toHaveCount(1)

  await page.getByLabel('汇报名称').fill('P07 已重命名')
  await page.getByLabel('汇报名称').press('Tab')
  await expect(page.getByText('汇报名称已更新。')).toBeVisible()
})

test('P07 reloads a presentation conflict and remains responsive on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 900 })
  await page.goto('/')
  await page.route('**/api/presentations/*/items', async (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Presentation has changed; reload and retry' }) })
    return route.continue()
  })
  await page.getByRole('button', { name: '加入汇报：市场分析报告' }).click()
  await expect(page.getByText('检测到较新版本，已重新加载；请确认后再试。')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
