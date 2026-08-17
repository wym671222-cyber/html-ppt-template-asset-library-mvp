import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { AssetLibraryCatalog } from '../apps/api/src/assets/library-catalog.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { LocalJobRepository } from '../apps/api/src/jobs/local-jobs.js'
import { PresentationRepository } from '../apps/api/src/presentations/presentation-repository.js'
import { PresentationExportRepository } from '../apps/api/src/presentation-exports/presentation-export-repository.js'
import {
  TEMPLATE_PREVIEW_JOB_TYPE,
  TemplatePreviewJobWorker,
  type PreviewRenderer,
} from '../apps/api/src/previews/preview-jobs.js'
import { PreviewPolicyError, SecurePreviewRenderer, type SecurePreviewRender } from '../apps/api/src/previews/secure-preview.js'
import { assertSafeInteractiveTemplatePackage } from '../apps/api/src/templates/interactive-template-policy.js'
import { compileInteractiveTemplateRuntime } from '../apps/api/src/templates/interactive-template-runtime.js'
import { TemplateImportService, parseUploadedTemplateZip } from '../apps/api/src/templates/template-import.js'
import { adaptTemplatePackageSource } from '../apps/api/src/templates/simulated-adapter.js'
import { isAllowlistedInteractiveTemplateDigest } from '../apps/api/src/templates/interactive-template-allowlist.js'
import { createStoredZip, readStoredZip } from '../apps/api/src/presentation-exports/offline-archive.js'
import {
  P05_INTERACTIVE_FIXTURE_IDS,
  P05_INTERACTIVE_FIXTURES,
  P05_LOCAL_LIBRARY_VERSIONS,
  P05_PRODUCTION_METADATA,
  createP05InteractivePackage,
  createP05InteractiveSource,
  createP05PackageZip,
  createP05V1BaselinePackage,
  createP05V1BaselineSource,
  p05FixtureDigests,
  writeP05InteractiveFixtureDirectory,
} from '../fixtures/p05-interactive-v2/generator.js'
import { TEST_MEMBER_ID, TEST_USER_ID, seedTestUser, testOwner } from './p14-test-support.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): { all(...parameters: unknown[]): unknown[]; get(...parameters: unknown[]): unknown; run(...parameters: unknown[]): { changes: number } }
  close(): void
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const chromiumExecutablePath = process.env.P05_CHROMIUM_PATH ?? (existsSync(macChrome) ? macChrome : undefined)
const origin = 'http://127.0.0.1:5173'

function openIsolatedDatabase(): { database: SQLite; store: LocalContentStore } {
  const root = mkdtempSync(join(tmpdir(), 'asset-library-p05-fixtures-'))
  const databasePath = join(root, 'asset-library.db')
  migrateDatabase(databasePath)
  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  return { database, store: new LocalContentStore(join(root, 'objects')) }
}

function fakePng(width: number, height: number, marker: number): Buffer {
  const content = Buffer.alloc(25)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(content)
  content.writeUInt32BE(13, 8)
  content.write('IHDR', 12, 'ascii')
  content.writeUInt32BE(width, 16)
  content.writeUInt32BE(height, 20)
  content[24] = marker
  return content
}

function fakeRenderer(rendererVersion = 'p05-fixture-baseline'): PreviewRenderer {
  const diagnostic: SecurePreviewRender['diagnostic'] = {
    allowedRequestCount: 1,
    blockedRequestCount: 0,
    blockedSecurityEventCount: 0,
    cookieHeaderCount: 0,
    contextCookieCount: 0,
    documentCookiePresent: false,
    forbiddenDomNodeCount: 0,
    newWindowCount: 0,
  }
  return { render: async () => ({ previewPng: fakePng(1280, 720, 1), thumbnailPng: fakePng(320, 180, 2), rendererVersion, diagnostic }) }
}

function zipSource(source: ReturnType<typeof createP05InteractiveSource>): Buffer {
  return createStoredZip([
    { relativePath: 'manifest.json', content: Buffer.from(`${JSON.stringify(source.manifest, null, 2)}\n`, 'utf8') },
    ...source.manifest.files.map((name) => ({ relativePath: name, content: Buffer.from(source.files[name], 'utf8') })),
  ])
}

function authFor(admin: ReturnType<typeof seedTestUser>, member: ReturnType<typeof seedTestUser>) {
  return {
    authenticate: (cookie: string | null | undefined) => cookie === 'session=admin'
      ? { user: admin, session: { id: 'session-admin', userId: admin.id, createdAt: admin.createdAt, expiresAt: admin.createdAt + 1 } }
      : cookie === 'session=member'
        ? { user: member, session: { id: 'session-member', userId: member.id, createdAt: member.createdAt, expiresAt: member.createdAt + 1 } }
        : null,
    recordFailure: () => undefined,
  }
}

function headers(role: 'admin' | 'member') {
  return { origin, cookie: `session=${role}`, 'content-type': 'application/json' }
}

describe('P05 deterministic interactive fixture catalogue', () => {
  it('generates twelve exact v2 packages with reproducible bytes and reviewed digests', async () => {
    expect(P05_INTERACTIVE_FIXTURE_IDS).toHaveLength(12)
    expect(new Set(P05_INTERACTIVE_FIXTURE_IDS).size).toBe(12)
    const generatedRootA = mkdtempSync(join(tmpdir(), 'p05-generated-a-'))
    const generatedRootB = mkdtempSync(join(tmpdir(), 'p05-generated-b-'))
    writeP05InteractiveFixtureDirectory(generatedRootA)
    writeP05InteractiveFixtureDirectory(generatedRootB)
    expect(readFileSync(join(generatedRootA, P05_INTERACTIVE_FIXTURE_IDS[0], 'manifest.json'))).toEqual(readFileSync(join(generatedRootB, P05_INTERACTIVE_FIXTURE_IDS[0], 'manifest.json')))
    expect(readFileSync(join(generatedRootA, P05_INTERACTIVE_FIXTURE_IDS[11], 'runtime.js'))).toEqual(readFileSync(join(generatedRootB, P05_INTERACTIVE_FIXTURE_IDS[11], 'runtime.js')))
    const digests = p05FixtureDigests()
    for (const assetId of P05_INTERACTIVE_FIXTURE_IDS) {
      const source = createP05InteractiveSource(assetId)
      assertSafeInteractiveTemplatePackage(source)
      expect(source.manifest).toMatchObject({ id: assetId, version: 2, contractVersion: 'html-template/v2', runtime: { mode: 'sandboxed-js', viewport: { width: 1920, height: 1080 } }, ...P05_PRODUCTION_METADATA[assetId] })
      expect(source.manifest.files).toContain('index.html')
      expect(source.manifest.files).toContain('styles.css')
      expect(source.manifest.files).toContain('runtime.js')
      expect(source.manifest.files).toContainEqual(expect.stringMatching(/^vendor\/.+\.min\.js$/))
      expect(source.manifest.files.every((file) => /^(?:index\.html|styles\.css|runtime\.js|vendor\/[a-z0-9-]+\.min\.js)$/.test(file))).toBe(true)
      expect(digests[assetId]).toMatch(/^[0-9a-f]{64}$/)
      expect(isAllowlistedInteractiveTemplateDigest(digests[assetId])).toBe(true)
      const firstZip = createP05PackageZip(assetId)
      const secondZip = createP05PackageZip(assetId)
      expect(firstZip).toEqual(secondZip)
      expect(firstZip.byteLength).toBeLessThan(5 * 1024 * 1024)
      const parsed = await parseUploadedTemplateZip(firstZip)
      expect(parsed.version.sourceDigest).toBe(digests[assetId])
      expect(parsed.version.versionNumber).toBe(2)
    }
    expect(P05_INTERACTIVE_FIXTURES.map((fixture) => fixture.title)).toEqual([
      '动态标题导演', '叙事时间线', '数据变形叙事', '决策象限', '流向探索器', '关系星图',
      '3D 系统轨道', '生成式品牌场', '物理优先级场', '图像焦点地图', '转型对照镜', '实时组件编排器',
    ])
    expect(P05_LOCAL_LIBRARY_VERSIONS).toEqual({ gsap: '3.13.0', echarts: '5.6.0', d3: '7.9.0', three: '0.152.2', p5: '2.1.1', 'matter-js': '0.20.0', interactjs: '1.10.27' })
  }, 30_000)

  it('rejects external, iframe, file/blob, and traversal references before isolated registration', () => {
    const source = createP05InteractiveSource(P05_INTERACTIVE_FIXTURE_IDS[0])
    const variants = [
      '<iframe src="https://example.test"></iframe>',
      '<img src="file:///etc/passwd">',
      '<img src="blob:https://example.test/id">',
      '<img src="../outside.png">',
      '<iframe src="https://example.test"></iframe><script src="runtime.js"></script>',
    ]
    for (const value of variants) {
      expect(() => assertSafeInteractiveTemplatePackage({ ...source, files: { ...source.files, 'index.html': value } })).toThrow()
    }
    const { database, store } = openIsolatedDatabase()
    try {
      expect(() => new AssetCatalogRepository(database as never, store).registerTemplate(createP05InteractivePackage(P05_INTERACTIVE_FIXTURE_IDS[0]))).not.toThrow()
      expect(database.prepare('SELECT count(*) AS count FROM template_assets').get()).toEqual({ count: 1 })
    } finally { database.close() }
  })
})

describe.skipIf(!chromiumExecutablePath)('P05 production-ID interactive runtime acceptance', () => {
  it('uses a sandboxed offline document and proves every component changes its own observable state', async () => {
    const browser = await chromium.launch({ executablePath: chromiumExecutablePath })
    try {
      for (const fixture of P05_INTERACTIVE_FIXTURES) {
        const page = await browser.newPage()
        await page.setViewportSize({ width: 1024, height: 768 })
        const blockedRequests: string[] = []
        page.on('request', (request) => { if (/^https?:/i.test(request.url())) blockedRequests.push(request.url()) })
        const compiled = compileInteractiveTemplateRuntime(createP05InteractiveSource(fixture.id), { offline: true })
        await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#p05-runtime{display:block;width:960px;height:540px;border:0}</style><iframe id="p05-runtime" sandbox="allow-scripts" width="960" height="540" src="data:text/html;base64,${compiled.html.toString('base64')}"></iframe>`)
        await expect.poll(() => page.frame({ name: 'ppt-template-document' })?.url().startsWith('data:text/html') ?? false).toBe(true)
        const frame = page.frame({ name: 'ppt-template-document' })!
        await frame.locator('#stage').waitFor()
        expect(await page.locator('#p05-runtime').getAttribute('sandbox')).toBe('allow-scripts')
        switch (fixture.kind) {
          case 'title':
            await frame.locator('#replay').click()
            expect(await frame.locator('html').getAttribute('data-animation-cycle')).toBe('1')
            break
          case 'timeline':
            await frame.locator('#timeline-next').click()
            expect(await frame.locator('html').getAttribute('data-timeline-step')).toBe('1')
            break
          case 'chart':
            await frame.locator('#switch-view').click()
            expect(await frame.locator('html').getAttribute('data-chart-view')).toBe('line')
            break
          case 'quadrant':
            await frame.locator('[data-quadrant="defend"]').click()
            expect(await frame.locator('html').getAttribute('data-quadrant')).toBe('defend')
            break
          case 'flow':
            await frame.locator('[data-flow="launch"]').click()
            expect(await frame.locator('html').getAttribute('data-flow-focus')).toBe('launch')
            break
          case 'star': {
            const svgBox = await frame.locator('#star-map').boundingBox()
            const circle = frame.locator('#star-map circle').first()
            const circleBox = await circle.boundingBox()
            if (!svgBox || !circleBox) throw new Error('Star map is not visible')
            const initialCx = await circle.getAttribute('cx')
            await page.mouse.move(circleBox.x + circleBox.width / 2, circleBox.y + circleBox.height / 2)
            await page.mouse.down()
            await page.mouse.move(circleBox.x + circleBox.width / 2 + 52, circleBox.y + circleBox.height / 2 + 26, { steps: 6 })
            await page.mouse.up()
            await expect.poll(() => frame.locator('html').getAttribute('data-star-dragged')).toBe('true')
            expect(await circle.getAttribute('cx')).not.toBe(initialCx)
            await page.mouse.move(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2)
            await page.mouse.wheel(0, -240)
            await expect.poll(async () => Number(await frame.locator('html').getAttribute('data-star-zoom') ?? '1')).toBeGreaterThan(1)
            break
          }
          case 'orbit': {
            const canvas = frame.locator('#orbit-canvas')
            const box = await canvas.boundingBox()
            if (!box) throw new Error('Orbit canvas is not visible')
            const startX = box.x + box.width / 2
            const startY = box.y + box.height / 2
            await page.mouse.move(startX, startY)
            await page.mouse.down()
            await page.mouse.move(startX + 64, startY + 24, { steps: 6 })
            await expect.poll(() => frame.locator('html').getAttribute('data-webgl')).toBe('ready')
            await expect.poll(async () => Number(await frame.locator('html').getAttribute('data-orbit-angle') ?? '0')).toBeGreaterThan(0)
            await page.mouse.up()
            break
          }
          case 'particles':
            await frame.locator('#particle-burst').click()
            expect(await frame.locator('html').getAttribute('data-particles')).toBe('20')
            break
          case 'physics':
            await frame.locator('#physics-step').click()
            expect(await frame.locator('html').getAttribute('data-physics-ticks')).toBe('1')
            break
          case 'focus':
            await frame.locator('#zoom-in').click()
            expect(await frame.locator('html').getAttribute('data-focus-scale')).toBe('1.2')
            break
          case 'compare':
            await frame.locator('#compare-range').evaluate((element) => { const input = element as HTMLInputElement; input.value = '72'; input.dispatchEvent(new Event('input', { bubbles: true })) })
            expect(await frame.locator('html').getAttribute('data-compare-position')).toBe('72')
            break
          case 'composer': {
            const card = frame.locator('#layout-card')
            const box = await card.boundingBox()
            if (!box) throw new Error('Composer card is not visible')
            const startX = box.x + box.width / 2
            const startY = box.y + box.height / 2
            await page.mouse.move(startX, startY)
            await page.mouse.down()
            await page.mouse.move(startX + 46, startY + 26, { steps: 6 })
            await page.mouse.up()
            await expect.poll(async () => Number(await frame.locator('html').getAttribute('data-layout-x') ?? '0')).toBeGreaterThan(0)
            await expect.poll(async () => Number(await frame.locator('html').getAttribute('data-layout-y') ?? '0')).toBeGreaterThan(0)
            expect(await card.getAttribute('style')).toMatch(/translate\(/)
            break
          }
        }
        expect(blockedRequests).toEqual([])
        await page.close()
      }
    } finally { await browser.close() }
  }, 180_000)
})

describe.skipIf(!chromiumExecutablePath)('P05 isolated 12-package migration, preview, retirement, and export rehearsal', () => {
  it('keeps v1 baselines, promotes only complete real-Chromium pairs, and preserves historical exports', async () => {
    const { database, store } = openIsolatedDatabase()
    try {
      const admin = seedTestUser(database as never, TEST_USER_ID, 'admin')
      const member = seedTestUser(database as never, TEST_MEMBER_ID, 'member')
      const catalogRepository = new AssetCatalogRepository(database as never, store)
      const jobs = new LocalJobRepository(database as never)
      const imports = new TemplateImportService(database as never, catalogRepository, jobs)
      const baselines = new Map<string, ReturnType<typeof createP05V1BaselinePackage>>()
      const baselineRows = new Map<string, ReturnType<AssetCatalogRepository['registerTemplate']>>()

      for (const assetId of P05_INTERACTIVE_FIXTURE_IDS) {
        const baseline = createP05V1BaselinePackage(assetId)
        baselines.set(assetId, baseline)
        baselineRows.set(assetId, catalogRepository.registerTemplate(baseline))
      }
      const baselineWorker = new TemplatePreviewJobWorker(database as never, jobs, store, fakeRenderer(), 'p05-v1-baseline', 60_000)
      const firstBaseline = baselineRows.get(P05_INTERACTIVE_FIXTURE_IDS[0])!
      jobs.enqueue({ id: 'p05-v1-baseline-01', type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: { templateVersionId: firstBaseline.versionId, contentObjectDigest: firstBaseline.contentObject.digest }, inputRevision: 1 })
      await expect(baselineWorker.runOnce()).resolves.toBe(true)

      const presentations = new PresentationRepository(database as never)
      let historical = presentations.create(testOwner(TEST_MEMBER_ID), 'P05 historical v1')
      historical = presentations.add(testOwner(TEST_MEMBER_ID), historical.id, firstBaseline.versionId, historical.revision)
      const historicalItem = historical.items[0]

      const failingCandidate = createP05InteractivePackage(P05_INTERACTIVE_FIXTURE_IDS[0])
      const failedRegistration = catalogRepository.registerTemplate(failingCandidate, { promote: false })
      jobs.enqueue({ id: 'p05-v2-partial-failure', type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: { templateVersionId: failedRegistration.versionId, contentObjectDigest: failedRegistration.contentObject.digest }, inputRevision: 2, maxAttempts: 1 })
      const failingWorker = new TemplatePreviewJobWorker(database as never, jobs, store, { render: async () => { throw new PreviewPolicyError('intentional partial derivative failure') } }, 'p05-v2-fail', 60_000)
      await expect(failingWorker.runOnce()).resolves.toBe(true)
      expect(jobs.get('p05-v2-partial-failure')).toMatchObject({ status: 'failed' })
      expect(database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(P05_INTERACTIVE_FIXTURE_IDS[0])).toEqual({ current_version_id: firstBaseline.versionId })
      expect(database.prepare('SELECT count(*) AS count FROM template_preview_derivatives WHERE template_version_id = ?').get(failedRegistration.versionId)).toEqual({ count: 0 })

      const summaries = []
      for (const assetId of P05_INTERACTIVE_FIXTURE_IDS) summaries.push(await imports.importZip(createP05PackageZip(assetId)))
      expect(summaries).toHaveLength(12)
      expect(summaries.every((summary) => summary.job.status === 'pending')).toBe(true)

      const chromiumWorker = new TemplatePreviewJobWorker(database as never, jobs, store, new SecurePreviewRenderer({ chromiumExecutablePath, navigationTimeoutMs: 20_000 }), 'p05-v2-chromium', 60_000)
      for (let index = 0; index < 12; index += 1) await expect(chromiumWorker.runOnce()).resolves.toBe(true)
      expect(database.prepare("SELECT count(*) AS count FROM template_preview_derivatives WHERE renderer_version LIKE 'p02-chromium-v2:%'").get()).toEqual({ count: 24 })
      expect(database.prepare("SELECT count(*) AS count FROM template_assets WHERE current_version_id LIKE '%-v2'").get()).toEqual({ count: 12 })

      for (const summary of summaries) {
        expect(jobs.get(summary.job.id)).toMatchObject({ status: 'succeeded' })
        const pair = database.prepare(`SELECT preview.source_digest AS source_digest, preview.renderer_version AS renderer_version,
          preview.content_digest AS preview_digest, thumbnail.content_digest AS thumbnail_digest,
          preview.security_diagnostic AS security_diagnostic
          FROM template_preview_derivatives preview JOIN template_preview_derivatives thumbnail
            ON thumbnail.template_version_id = preview.template_version_id AND thumbnail.source_digest = preview.source_digest
            AND thumbnail.renderer_version = preview.renderer_version AND thumbnail.kind = 'thumbnail'
          WHERE preview.template_version_id = ? AND preview.kind = 'preview'`).get(summary.versionId) as { source_digest: string; renderer_version: string; preview_digest: string; thumbnail_digest: string; security_diagnostic: string }
        expect(pair.source_digest).toBe(summary.job.id ? createP05InteractivePackage(summary.assetId).version.sourceDigest : '')
        expect(pair.renderer_version).toMatch(/^p02-chromium-v2:/)
        expect(store.read(pair.preview_digest).readUInt32BE(16)).toBe(1280)
        expect(store.read(pair.preview_digest).readUInt32BE(20)).toBe(720)
        expect(store.read(pair.thumbnail_digest).readUInt32BE(16)).toBe(320)
        expect(store.read(pair.thumbnail_digest).readUInt32BE(20)).toBe(180)
        expect(JSON.parse(pair.security_diagnostic)).toMatchObject({ blockedRequestCount: 0, blockedSecurityEventCount: 0, cookieHeaderCount: 0, contextCookieCount: 0, networkAuditHitCount: 0, selfNavigationAuditHitCount: 0, allowScriptsOnlySandbox: true })
      }

      const countsBeforeRepeat = database.prepare('SELECT (SELECT count(*) FROM template_versions) AS versions, (SELECT count(*) FROM jobs) AS jobs, (SELECT count(*) FROM content_objects) AS objects').get()
      for (const assetId of P05_INTERACTIVE_FIXTURE_IDS) {
        const repeated = await imports.importZip(createP05PackageZip(assetId))
        expect(repeated.created).toBe(false)
        expect(repeated.job.status).toBe('succeeded')
        expect(repeated.job.available).toBe(true)
      }
      expect(database.prepare('SELECT (SELECT count(*) FROM template_versions) AS versions, (SELECT count(*) FROM jobs) AS jobs, (SELECT count(*) FROM content_objects) AS objects').get()).toEqual(countsBeforeRepeat)

      const forgedJob = 'p05-forged-digest'
      jobs.enqueue({ id: forgedJob, type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: { templateVersionId: summaries[0].versionId, contentObjectDigest: 'a'.repeat(64) }, inputRevision: 2, maxAttempts: 1 })
      await expect(chromiumWorker.runOnce()).resolves.toBe(true)
      expect(jobs.get(forgedJob)).toMatchObject({ status: 'failed' })
      expect(database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(P05_INTERACTIVE_FIXTURE_IDS[0])).toEqual({ current_version_id: `${P05_INTERACTIVE_FIXTURE_IDS[0]}-v2` })
      expect(() => catalogRepository.registerTemplate(baselines.get(P05_INTERACTIVE_FIXTURE_IDS[0])!, { promote: true })).not.toThrow()
      expect(database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(P05_INTERACTIVE_FIXTURE_IDS[0])).toEqual({ current_version_id: `${P05_INTERACTIVE_FIXTURE_IDS[0]}-v2` })

      const unsafeSource = { ...createP05InteractiveSource(P05_INTERACTIVE_FIXTURE_IDS[1]), files: { ...createP05InteractiveSource(P05_INTERACTIVE_FIXTURE_IDS[1]).files, 'index.html': '<img src="https://outside.invalid/a.png">' } }
      const countsBeforeUnsafe = database.prepare('SELECT count(*) AS count FROM template_assets').get()
      await expect(parseUploadedTemplateZip(zipSource(unsafeSource))).rejects.toThrow(/external|active|resource/i)
      expect(database.prepare('SELECT count(*) AS count FROM template_assets').get()).toEqual(countsBeforeUnsafe)

      const auth = authFor(admin, member)
      const app = createApp({ catalog: new AssetLibraryCatalog(database as never, store), presentations, auth: auth as never })
      const retirementIds = ['html-4d353ff9f58e974d4e8a', 'html-ef7410b3f4732cb7df31', 'html-221e1002d8e216bfefde']
      const retirementRows = retirementIds.map((assetId) => {
        const source = createP05V1BaselineSource(P05_INTERACTIVE_FIXTURE_IDS[0])
        return catalogRepository.registerTemplate(adaptTemplatePackageSource({
          ...source,
          manifest: { ...source.manifest, id: assetId, title: `P05 isolated retirement ${assetId}` },
        }, 'tests/p05-interactive-fixtures.test.ts'))
      })
      for (const assetId of retirementIds) {
        const response = await app.request(`http://127.0.0.1:3001/api/admin/templates/${assetId}/retire`, { method: 'POST', headers: headers('admin'), body: '{}' })
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ template: { assetId, status: 'retired', alreadyRetired: false } })
      }
      const repeated = await app.request(`http://127.0.0.1:3001/api/admin/templates/${retirementIds[0]}/retire`, { method: 'POST', headers: headers('admin'), body: '{}' })
      expect(await repeated.json()).toMatchObject({ template: { alreadyRetired: true } })
      const catalogIds = (await (await app.request('http://127.0.0.1:3001/api/catalog', { headers: headers('member') })).json() as { items: Array<{ id: string }> }).items.map((item) => item.id)
      expect(catalogIds).not.toEqual(expect.arrayContaining(retirementIds))
      expect(catalogIds).toEqual(expect.arrayContaining([...P05_INTERACTIVE_FIXTURE_IDS]))
      const persisted = presentations.read(testOwner(TEST_MEMBER_ID), historical.id)
      expect(persisted.items[0].templateVersionId).toBe(firstBaseline.versionId)
      expect(persisted.items[0].template.versionNumber).toBe(1)
      const blockedAdd = await app.request(`http://127.0.0.1:3001/api/presentations/${historical.id}/items`, { method: 'POST', headers: headers('member'), body: JSON.stringify({ templateVersionId: retirementRows[0].versionId, expectedRevision: persisted.revision }) })
      expect(blockedAdd.status).toBe(409)
      const audit = database.prepare("SELECT action, entity_id, diagnostic FROM audit_events WHERE action = 'admin.template_retire' ORDER BY created_at, id").all()
      expect(audit).toHaveLength(4)
      expect(audit).toEqual(expect.arrayContaining([{ action: 'admin.template_retire', entity_id: retirementIds[0], diagnostic: 'TEMPLATE_RETIRED' }, { action: 'admin.template_retire', entity_id: retirementIds[0], diagnostic: 'ALREADY_RETIRED' }]))

      const exported = new PresentationExportRepository(database as never, store).create(testOwner(TEST_MEMBER_ID), historical.id, persisted.revision, [historicalItem.id])
      expect(exported.manifest.contractVersion).toBe('html-presentation-export/v3')
      const html = new PresentationExportRepository(database as never, store).readArtifact(testOwner(TEST_MEMBER_ID), historical.id, exported.summary.id, 'html').toString('utf8')
      expect(html).toContain('slides/slide-0001.html')
      const zip = new PresentationExportRepository(database as never, store).readArtifact(testOwner(TEST_MEMBER_ID), historical.id, exported.summary.id, 'zip')
      expect(readStoredZip(zip).get('slides/slide-0001.html')?.toString('utf8')).toContain('data:image/png;base64,')
    } finally { database.close() }
  }, 240_000)
})
