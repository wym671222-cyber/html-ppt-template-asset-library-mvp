import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { LocalJobRepository } from '../apps/api/src/jobs/local-jobs.js'
import {
  TEMPLATE_PREVIEW_JOB_TYPE,
  TemplatePreviewJobWorker,
  type PreviewRenderer,
} from '../apps/api/src/previews/preview-jobs.js'
import {
  assertSafePreviewPackage,
  isAllowedPreviewRequest,
  SecurePreviewRenderer,
  type SecurePreviewRender,
} from '../apps/api/src/previews/secure-preview.js'
import { queueCurrentPreviewRefresh } from '../apps/api/src/previews/requeue-current-previews.js'
import { adaptSimulatedTemplatePackage } from '../apps/api/src/templates/simulated-adapter.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): { all(...parameters: unknown[]): unknown[]; get(...parameters: unknown[]): unknown; run(...parameters: unknown[]): { changes: number } }
  close(): void
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite
const fixture = join(process.cwd(), 'fixtures/p03-simulated-template')
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const chromiumExecutablePath = process.env.P05_CHROMIUM_PATH ?? (existsSync(macChrome) ? macChrome : undefined)

function openMigratedDatabase(): { database: SQLite; store: LocalContentStore } {
  const directory = mkdtempSync(join(tmpdir(), 'asset-library-p05-'))
  const path = join(directory, 'asset-library.db')
  migrateDatabase(path)
  const database = new Database(path)
  database.pragma('foreign_keys = ON')
  return { database, store: new LocalContentStore(join(directory, 'objects')) }
}

function registeredFixture(database: SQLite, store: LocalContentStore) {
  const template = adaptSimulatedTemplatePackage(fixture)
  const registered = new AssetCatalogRepository(database as never, store).registerTemplate(template)
  return { template, registered }
}

function pngDimensions(content: Buffer): { width: number; height: number } {
  expect(content.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) }
}

function fakeRender(rendererVersion = 'p05-test-renderer'): SecurePreviewRender {
  const fakePng = (width: number, height: number, marker: number) => {
    const content = Buffer.alloc(25)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(content)
    content.writeUInt32BE(13, 8)
    content.write('IHDR', 12, 'ascii')
    content.writeUInt32BE(width, 16)
    content.writeUInt32BE(height, 20)
    content[24] = marker
    return content
  }
  return {
    previewPng: fakePng(1280, 720, 1),
    thumbnailPng: fakePng(320, 180, 2),
    rendererVersion,
    diagnostic: {
      allowedRequestCount: 1,
      blockedRequestCount: 0,
      blockedSecurityEventCount: 0,
      cookieHeaderCount: 0,
      contextCookieCount: 0,
      documentCookiePresent: false,
      forbiddenDomNodeCount: 0,
      newWindowCount: 0,
    },
  }
}

describe('P05 stored package and Chromium request policy', () => {
  it('rejects tampered paths, undeclared resources, scripts, external links, CSS fetches, frames, forms, and new-window markup', () => {
    const template = adaptSimulatedTemplatePackage(fixture)
    const withEntry = (entry: string) => ({ ...template.source, files: { ...template.source.files, 'index.html': entry } })

    expect(() => assertSafePreviewPackage({ ...template.source, files: { ...template.source.files, 'undeclared.css': 'body{}' } })).toThrow(/undeclared resource/)
    expect(() => assertSafePreviewPackage(withEntry('<script>location="https://example.test"</script>'))).toThrow(/scripts|active or navigational/)
    expect(() => assertSafePreviewPackage(withEntry('<img src="https://example.test/tracker.png">'))).toThrow(/external reference|external URLs/)
    expect(() => assertSafePreviewPackage(withEntry('<iframe src="styles.css"></iframe>'))).toThrow(/active or navigational/)
    expect(() => assertSafePreviewPackage(withEntry('<form action="styles.css"><button>send</button></form>'))).toThrow(/active or navigational/)
    expect(() => assertSafePreviewPackage(withEntry('<a href="styles.css" target="_blank">open</a>'))).toThrow(/active or navigational/)
    expect(() => assertSafePreviewPackage({ ...template.source, files: { ...template.source.files, 'styles.css': 'body{background:url(https://example.test/x)}' } })).toThrow(/cannot import or fetch/)

    const origin = 'http://127.0.0.1:43123'
    const allowedPaths = new Set(['/token/index.html', '/token/styles.css'])
    expect(isAllowedPreviewRequest(`${origin}/token/index.html`, 'GET', origin, allowedPaths)).toBe(true)
    expect(isAllowedPreviewRequest('https://example.test/x', 'GET', origin, allowedPaths)).toBe(false)
    expect(isAllowedPreviewRequest('file:///etc/passwd', 'GET', origin, allowedPaths)).toBe(false)
    expect(isAllowedPreviewRequest(`${origin}/outside`, 'GET', origin, allowedPaths)).toBe(false)
    expect(isAllowedPreviewRequest(`${origin}/token/missing.css`, 'GET', origin, allowedPaths)).toBe(false)
    expect(isAllowedPreviewRequest(`${origin}/token/index.html`, 'POST', origin, allowedPaths)).toBe(false)
  })

  it('rejects invalid Job snapshots and verified CAS tampering without creating derivatives', async () => {
    const { database, store } = openMigratedDatabase()
    try {
      const { template, registered } = registeredFixture(database, store)
      const jobs = new LocalJobRepository(database as never)
      const renderer: PreviewRenderer = { render: async () => fakeRender() }
      const worker = new TemplatePreviewJobWorker(database as never, jobs, store, renderer, 'p05-worker', 30_000)

      jobs.enqueue({ id: 'invalid-preview', type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: { templateVersionId: template.version.id, contentObjectDigest: '../bad' }, inputRevision: 0 })
      await expect(worker.runOnce()).resolves.toBe(true)
      expect(jobs.get('invalid-preview')).toMatchObject({ status: 'failed', attempt: 1 })

      writeFileSync(join(store.root, registered.contentObject.relativePath), 'tampered package')
      jobs.enqueue({ id: 'tampered-preview', type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: { templateVersionId: template.version.id, contentObjectDigest: registered.contentObject.digest }, inputRevision: 0 })
      await expect(worker.runOnce()).resolves.toBe(true)
      expect(jobs.get('tampered-preview')).toMatchObject({ status: 'failed', attempt: 1 })
      expect(database.prepare('SELECT count(*) AS count FROM template_preview_derivatives').get()).toEqual({ count: 0 })
    } finally {
      database.close()
    }
  })
})

describe('P05 preview Job lifecycle and append-only derivatives', () => {
  it('plans and idempotently queues a bounded current-template thumbnail refresh', () => {
    const { database, store } = openMigratedDatabase()
    try {
      registeredFixture(database, store)
      expect(() => queueCurrentPreviewRefresh(database as never, 2, true)).toThrow(/expected 2, received 1/)
      expect(new LocalJobRepository(database as never).claim('must-stay-empty', 1_000, [TEMPLATE_PREVIEW_JOB_TYPE])).toBeUndefined()
      expect(queueCurrentPreviewRefresh(database as never, 1, false)).toEqual({ targetCount: 1, existingCount: 0, queuedCount: 1, applied: false })
      expect(queueCurrentPreviewRefresh(database as never, 1, true)).toEqual({ targetCount: 1, existingCount: 0, queuedCount: 1, applied: true })
      expect(queueCurrentPreviewRefresh(database as never, 1, true)).toEqual({ targetCount: 1, existingCount: 1, queuedCount: 0, applied: true })
    } finally {
      database.close()
    }
  })

  it('migrates an empty and an existing target database with integrity and foreign keys intact', () => {
    const directory = mkdtempSync(join(tmpdir(), 'asset-library-p05-migration-'))
    const path = join(directory, 'asset-library.db')
    expect(migrateDatabase(path)).toMatchObject({ existed: false })
    const repeated = migrateDatabase(path)
    expect(repeated).toMatchObject({ existed: true })
    expect(repeated.pendingMigrationCount).toBe(0)
    expect(repeated.backupSha256).toBeUndefined()
    expect(repeated.backupPath).toBeUndefined()
    const database = new Database(path)
    try {
      database.pragma('foreign_keys = ON')
      expect(database.pragma('quick_check', { simple: true })).toBe('ok')
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'template_preview_derivatives'").get()).toEqual({ count: 1 })
    } finally {
      database.close()
    }
  })

  it('filters Job types, retries a transient renderer failure, and does not replace successful outputs', async () => {
    const { database, store } = openMigratedDatabase()
    try {
      const { template, registered } = registeredFixture(database, store)
      const jobs = new LocalJobRepository(database as never)
      jobs.enqueue({ id: 'unrelated', type: 'fixture', inputSnapshot: {}, inputRevision: 0 })
      jobs.enqueue({ id: 'retry-preview', type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: { templateVersionId: template.version.id, contentObjectDigest: registered.contentObject.digest }, inputRevision: 0, maxAttempts: 2 })
      let callCount = 0
      const renderer: PreviewRenderer = {
        render: async () => {
          callCount += 1
          if (callCount === 1) throw new Error('simulated Chromium crash')
          return fakeRender()
        },
      }
      const worker = new TemplatePreviewJobWorker(database as never, jobs, store, renderer, 'p05-worker', 30_000)

      await expect(worker.runOnce()).resolves.toBe(true)
      expect(jobs.get('retry-preview')).toMatchObject({ status: 'pending', attempt: 1 })
      expect(jobs.get('unrelated')).toMatchObject({ status: 'pending', attempt: 0 })
      await expect(worker.runOnce()).resolves.toBe(true)
      expect(jobs.get('retry-preview')).toMatchObject({ status: 'succeeded', attempt: 2 })
      const succeededOutput = jobs.get('retry-preview')?.outputDigest
      expect(database.prepare('SELECT count(*) AS count FROM template_preview_derivatives').get()).toEqual({ count: 2 })

      jobs.enqueue({ id: 'conflicting-preview', type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: { templateVersionId: template.version.id, contentObjectDigest: registered.contentObject.digest }, inputRevision: 0, maxAttempts: 2 })
      const conflictingRenderer: PreviewRenderer = { render: async () => ({ ...fakeRender(), previewPng: Buffer.concat([fakeRender().previewPng, Buffer.from('conflict')]) }) }
      const conflictingWorker = new TemplatePreviewJobWorker(database as never, jobs, store, conflictingRenderer, 'p05-conflict', 30_000)
      await expect(conflictingWorker.runOnce()).resolves.toBe(true)
      expect(jobs.get('conflicting-preview')).toMatchObject({ status: 'failed', attempt: 1, outputDigest: null })
      expect(jobs.get('retry-preview')?.outputDigest).toBe(succeededOutput)
      expect(database.prepare('SELECT count(*) AS count FROM template_preview_derivatives').get()).toEqual({ count: 2 })
      expect(() => database.prepare("UPDATE template_preview_derivatives SET content_digest = ? WHERE kind = 'preview'").run('a'.repeat(64))).toThrow(/append-only/)
      expect(() => database.prepare("DELETE FROM template_preview_derivatives WHERE kind = 'thumbnail'").run()).toThrow(/append-only/)
      expect(() => jobs.fail('retry-preview', 'p05-worker', 'late failure')).toThrow(/lease is no longer held/)
    } finally {
      database.close()
    }
  })
})

describe.skipIf(!chromiumExecutablePath)('P05 controlled Chromium integration', () => {
  it('rejects an obfuscated external CSS request inside Chromium without allowing network access', async () => {
    const template = adaptSimulatedTemplatePackage(fixture)
    const source = {
      ...template.source,
      files: { ...template.source.files, 'styles.css': 'body{background-image:u\\72 l("https://example.test/blocked.png")}' },
    }
    const renderer = new SecurePreviewRenderer({ chromiumExecutablePath, navigationTimeoutMs: 20_000 })
    await expect(renderer.render(source)).rejects.toThrow(/Chromium CSP blocked|controlled preview allowlist/)
  }, 30_000)

  it('renders stable preview and thumbnail PNGs with an empty cookie context and loopback/package-only requests', async () => {
    const { database, store } = openMigratedDatabase()
    try {
      const { template, registered } = registeredFixture(database, store)
      const jobs = new LocalJobRepository(database as never)
      const renderer = new SecurePreviewRenderer({ chromiumExecutablePath, navigationTimeoutMs: 20_000 })
      const worker = new TemplatePreviewJobWorker(database as never, jobs, store, renderer, 'p05-chromium', 60_000)
      const snapshot = { templateVersionId: template.version.id, contentObjectDigest: registered.contentObject.digest }

      jobs.enqueue({ id: 'chromium-preview-1', type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: snapshot, inputRevision: 0, maxAttempts: 2 })
      await expect(worker.runOnce()).resolves.toBe(true)
      expect(jobs.get('chromium-preview-1')).toMatchObject({ status: 'succeeded', attempt: 1 })
      const first = database.prepare('SELECT kind, content_digest, security_diagnostic FROM template_preview_derivatives ORDER BY kind').all() as { kind: string; content_digest: string; security_diagnostic: string }[]
      expect(first.map((row) => row.kind)).toEqual(['preview', 'thumbnail'])
      const diagnostic = JSON.parse(first[0].security_diagnostic) as Record<string, unknown>
      expect(diagnostic).toMatchObject({ blockedRequestCount: 0, blockedSecurityEventCount: 0, cookieHeaderCount: 0, contextCookieCount: 0, documentCookiePresent: false, forbiddenDomNodeCount: 0, newWindowCount: 0 })
      expect(Number(diagnostic.allowedRequestCount)).toBeGreaterThanOrEqual(2)

      const preview = first.find((row) => row.kind === 'preview')!
      const thumbnail = first.find((row) => row.kind === 'thumbnail')!
      expect(pngDimensions(store.read(preview.content_digest))).toEqual({ width: 1280, height: 720 })
      expect(pngDimensions(store.read(thumbnail.content_digest))).toEqual({ width: 320, height: 180 })

      jobs.enqueue({ id: 'chromium-preview-2', type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: snapshot, inputRevision: 0, maxAttempts: 2 })
      await expect(worker.runOnce()).resolves.toBe(true)
      expect(jobs.get('chromium-preview-2')).toMatchObject({ status: 'succeeded', outputDigest: preview.content_digest })
      expect(database.prepare('SELECT count(*) AS count FROM template_preview_derivatives').get()).toEqual({ count: 2 })
      expect(readFileSync(join(store.root, store.relativePathFor(preview.content_digest)))).toEqual(store.read(preview.content_digest))
    } finally {
      database.close()
    }
  }, 60_000)

  it('scales the full-size composition into the thumbnail without triggering a narrow-viewport layout', async () => {
    const template = adaptSimulatedTemplatePackage(fixture)
    const source = {
      ...template.source,
      files: {
        ...template.source.files,
        'styles.css': `${template.source.files['styles.css']}\nhtml,body,.report{background:#ff0000!important}\n@media (max-width:500px){html,body,.report{background:#0000ff!important}}`,
      },
    }
    const renderer = new SecurePreviewRenderer({ chromiumExecutablePath, navigationTimeoutMs: 20_000 })
    const render = await renderer.render(source)
    const browser = await chromium.launch({ executablePath: chromiumExecutablePath, headless: true })
    try {
      const page = await browser.newPage()
      const centerPixel = (png: Buffer) => page.evaluate(async (base64) => {
        const image = new Image()
        image.src = `data:image/png;base64,${base64}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]
      }, png.toString('base64'))
      expect(await centerPixel(render.previewPng)).toEqual([255, 0, 0, 255])
      expect(await centerPixel(render.thumbnailPng)).toEqual([255, 0, 0, 255])
    } finally {
      await browser.close()
    }
  }, 60_000)
})
