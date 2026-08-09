import { expect, test } from '@playwright/test'

test('P09 creates a keyboard-accessible manifest and completes one isolated restore without changing source state', async ({ page, request }) => {
  await page.goto('/')
  const panel = page.locator('.recovery-panel')
  await expect(page.getByRole('heading', { name: '备份与恢复演练' })).toBeVisible()
  await expect(panel).toHaveAttribute('aria-busy', 'false')

  const beforeResponse = await request.get('/api/recovery')
  expect(beforeResponse.ok()).toBeTruthy()
  const before = await beforeResponse.json() as { recovery: { stateSha256: string; databaseSha256: string } }

  const backupButton = page.getByRole('button', { name: '生成备份清单' })
  await backupButton.focus()
  await expect(backupButton).toBeFocused()
  await backupButton.press('Enter')
  const backupNotice = page.getByText(/备份清单已生成并回读/)
  await expect(backupNotice).toBeVisible()
  await expect(backupNotice).toBeFocused()

  const manifestLink = page.getByRole('link', { name: 'Manifest' }).last()
  const manifestUrl = await manifestLink.getAttribute('href')
  const manifestResponse = await request.get(manifestUrl ?? '')
  expect(manifestResponse.ok()).toBeTruthy()
  const manifestPayload = await manifestResponse.json() as { manifestSha256: string; manifest: { contractVersion: string; database: { migrationLedger: unknown[] }; objects: Array<{ relativePath: string; digest: string }> } }
  expect(manifestPayload.manifest.contractVersion).toBe('asset-library-local-backup/v1')
  expect(manifestPayload.manifest.database.migrationLedger).toHaveLength(6)
  expect(manifestPayload.manifest.objects.every((object) => object.relativePath === `objects/sha256/${object.digest.slice(0, 2)}/${object.digest}`)).toBe(true)
  expect(JSON.stringify(manifestPayload)).not.toMatch(/\/Users\/|password|credential|api[_-]?key/i)

  const restoreButton = page.getByRole('button', { name: '隔离恢复演练' }).last()
  await restoreButton.focus()
  await expect(restoreButton).toBeFocused()
  await restoreButton.press('Enter')
  const restoreNotice = page.getByText(/隔离恢复演练已通过/)
  await expect(restoreNotice).toBeVisible()
  await expect(restoreNotice).toBeFocused()
  await expect(page.getByRole('button', { name: '恢复已验证' }).last()).toBeDisabled()

  const afterResponse = await request.get('/api/recovery')
  const after = await afterResponse.json() as { recovery: { stateSha256: string; databaseSha256: string; backups: Array<{ id: string; manifestSha256: string }> } }
  expect(after.recovery.stateSha256).toBe(before.recovery.stateSha256)
  expect(after.recovery.databaseSha256).toBe(before.recovery.databaseSha256)
  const backup = after.recovery.backups[0]
  const repeated = await request.post(`/api/recovery/backups/${backup.id}/restore`, { data: { expectedManifestSha256: backup.manifestSha256 } })
  expect(repeated.status()).toBe(409)

  expect(await page.locator('iframe, [srcdoc]').count()).toBe(0)
})

test('P09 recovery controls remain focused and usable at 680px while unsafe and legacy routes stay rejected', async ({ page, request }) => {
  await page.setViewportSize({ width: 680, height: 900 })
  await page.goto('/')
  await expect(page.locator('.recovery-panel')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('heading', { name: '备份与恢复演练' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Manifest' }).last()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  expect((await request.post('/api/recovery/backups', { data: { expectedStateSha256: '0'.repeat(64), path: '../outside' } })).status()).toBe(400)
  expect((await request.get('/api/recovery?path=../outside')).status()).toBe(400)
  for (const path of ['/api/auth/login', '/api/admin/users', '/api/preview', '/api/export', '/api/search']) expect((await request.get(path)).status()).toBe(404)
})
