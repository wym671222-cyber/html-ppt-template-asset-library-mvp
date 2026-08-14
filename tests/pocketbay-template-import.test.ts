import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { AssetLibraryCatalog } from '../apps/api/src/assets/library-catalog.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { LocalJobRepository } from '../apps/api/src/jobs/local-jobs.js'
import { TemplatePreviewJobWorker, type PreviewRenderer } from '../apps/api/src/previews/preview-jobs.js'
import type { SecurePreviewRender } from '../apps/api/src/previews/secure-preview.js'
import { parseUploadedTemplateZip, TemplateImportService, validateUploadedTemplateHtml } from '../apps/api/src/templates/template-import.js'
import { createTrustedTestAuth, seedTestUser, testOwner, TEST_MEMBER_ID } from './p14-test-support.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): { all(...parameters: unknown[]): unknown[]; get(...parameters: unknown[]): unknown; run(...parameters: unknown[]): { changes: number } }
  close(): void
}
type Zip = { file(name: string, content: string): Zip; generateAsync(options: { type: 'nodebuffer'; compression: 'DEFLATE' }): Promise<Buffer> }
type ZipConstructor = new () => Zip

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const Database = requireFromApi('better-sqlite3') as new (path: string) => SQLite
const JSZip = requireFromApi('jszip') as ZipConstructor
const fixtureRoot = join(process.cwd(), 'fixtures/p03-simulated-template')
const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function htmlBody(html: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    filename: 'quarterly.html',
    mimeType: 'text/html',
    contentBase64: Buffer.from(html, 'utf8').toString('base64'),
    title: '季度经营分析',
    summary: '面向管理层的季度经营复盘模板',
    category: '通用汇报',
    tags: ['季度汇报', '管理层'],
    ...overrides,
  }
}

async function fixtureZip(change?: (manifest: Record<string, unknown>, files: Record<string, string>) => void): Promise<Buffer> {
  const manifest = JSON.parse(readFileSync(join(fixtureRoot, 'manifest.json'), 'utf8')) as Record<string, unknown>
  const names = manifest.files as string[]
  const files = Object.fromEntries(names.map((name) => [name, readFileSync(join(fixtureRoot, name), 'utf8')]))
  change?.(manifest, files)
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest))
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
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

function fakeRender(): SecurePreviewRender {
  return {
    previewPng: fakePng(1280, 720, 1),
    thumbnailPng: fakePng(320, 180, 2),
    rendererVersion: 'pb03-fixture-renderer',
    diagnostic: { allowedRequestCount: 2, blockedRequestCount: 0, blockedSecurityEventCount: 0, cookieHeaderCount: 0, contextCookieCount: 0, documentCookiePresent: false, forbiddenDomNodeCount: 0, newWindowCount: 0 },
  }
}

function state() {
  const root = mkdtempSync(join(tmpdir(), 'asset-library-pb03-'))
  const databasePath = join(root, 'asset-library.db')
  migrateDatabase(databasePath)
  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  const admin = seedTestUser(database as never)
  const member = seedTestUser(database as never, TEST_MEMBER_ID, 'member')
  const store = new LocalContentStore(join(root, 'objects'))
  const jobs = new LocalJobRepository(database as never)
  const imports = new TemplateImportService(database as never, new AssetCatalogRepository(database as never, store), jobs)
  return { root, database, admin, member, store, jobs, imports }
}

describe('PocketBay administrator template import', () => {
  it('parses only an exact html-template/v1 file set and rejects active or unknown input', async () => {
    const parsed = await parseUploadedTemplateZip(await fixtureZip())
    expect(parsed).toMatchObject({ asset: { id: 'simulated-quarterly-brief' }, version: { id: 'simulated-quarterly-brief-v1' } })

    await expect(parseUploadedTemplateZip(await fixtureZip((manifest) => { manifest.unknown = true }))).rejects.toThrow(/unknown fields/)
    await expect(parseUploadedTemplateZip(await fixtureZip((manifest) => { manifest.files = 'index.html' }))).rejects.toThrow(/string array/)
    await expect(parseUploadedTemplateZip(await fixtureZip((_manifest, files) => { files['extra.css'] = 'body{}' }))).rejects.toThrow(/exactly match/)
    await expect(parseUploadedTemplateZip(await fixtureZip((_manifest, files) => { files['index.html'] = '<script>alert(1)</script>' }))).rejects.toThrow(/script|active/i)
    await expect(parseUploadedTemplateZip(await fixtureZip((manifest, files) => {
      ;(manifest.files as string[]).push('image.png')
      files['image.png'] = 'not-an-image'
    }))).rejects.toThrow(/only HTML and CSS/)
  })

  it('registers CAS once, queues one preview, stays hidden until a verified PNG pair, and is idempotent', async () => {
    const current = state()
    try {
      const zip = await fixtureZip()
      const first = await current.imports.importZip(zip)
      expect(first).toMatchObject({ created: true, assetId: 'simulated-quarterly-brief', job: { status: 'pending', available: false } })
      const query = { search: '', category: null, tags: [], status: null, sort: 'updated-desc' as const, limit: 48, offset: 0 }
      expect(new AssetLibraryCatalog(current.database as never, current.store).list(testOwner(current.admin.id), query)).toMatchObject({ total: 0 })

      const renderer: PreviewRenderer = { render: async () => fakeRender() }
      await expect(new TemplatePreviewJobWorker(current.database as never, current.jobs, current.store, renderer, 'pb03-worker', 30_000).runOnce()).resolves.toBe(true)
      expect(current.imports.job(first.job.id)).toMatchObject({ status: 'succeeded', available: true })
      expect(new AssetLibraryCatalog(current.database as never, current.store).list(testOwner(current.admin.id), query)).toMatchObject({ total: 1 })

      const repeated = await current.imports.importZip(zip)
      expect(repeated).toMatchObject({ created: false, job: { id: first.job.id, status: 'succeeded', available: true } })
      expect(current.database.prepare('SELECT count(*) AS count FROM template_versions').get()).toEqual({ count: 1 })
      expect(current.database.prepare('SELECT count(*) AS count FROM jobs').get()).toEqual({ count: 1 })
    } finally { current.database.close(); rmSync(current.root, { recursive: true, force: true }) }
  })

  it('normalizes one self-contained HTML file and rejects active, external, inline-style and forged data-image input', () => {
    const safe = htmlBody(`<!doctype html><html><head><style>body{margin:0;background:#fff}</style></head><body><img src="data:image/png;base64,${onePixelPng}"><h1>季度经营分析</h1></body></html>`)
    const first = validateUploadedTemplateHtml(safe)
    const second = validateUploadedTemplateHtml(safe)
    expect(first).toMatchObject({ assetId: expect.stringMatching(/^html-[0-9a-f]{20}$/), versionId: expect.stringMatching(/-v1$/), category: '通用汇报', tags: ['季度汇报', '管理层'], normalizedFiles: ['index.html', 'styles.css'] })
    expect(second.assetId).toBe(first.assetId)
    expect(() => validateUploadedTemplateHtml(htmlBody('<html><body><script>alert(1)</script></body></html>'))).toThrow(/active|script/i)
    expect(() => validateUploadedTemplateHtml(htmlBody('<html><body><img src="https://example.test/a.png"></body></html>'))).toThrow(/external|declared|reference/i)
    expect(() => validateUploadedTemplateHtml(htmlBody('<html><body style="color:red">x</body></html>'))).toThrow(/active|style/i)
    expect(() => validateUploadedTemplateHtml(htmlBody('<html><body><img src="data:image/png;base64,R0lGODlh"></body></html>'))).toThrow(/signature|MIME/i)
    expect(() => validateUploadedTemplateHtml(htmlBody('<html><body>x</body></html>', { filename: 'quarterly.txt' }))).toThrow(/\.html/)
    expect(() => validateUploadedTemplateHtml(htmlBody('<html><body>x</body></html>', { contentBase64: '***' }))).toThrow(/base64/i)
  })

  it('validates and imports self-contained HTML only for an authenticated administrator', async () => {
    const current = state()
    try {
      const origin = 'http://127.0.0.1:5173'
      const body = htmlBody('<!doctype html><html><head><style>body{margin:0}</style></head><body><h1>季度经营分析</h1></body></html>')
      const adminApp = createApp({ auth: createTrustedTestAuth(current.admin), templateImports: current.imports })
      const memberApp = createApp({ auth: createTrustedTestAuth(current.member), templateImports: current.imports })
      expect((await memberApp.request('http://127.0.0.1:3001/api/template-imports/html/validate', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(403)
      const validated = await adminApp.request('http://127.0.0.1:3001/api/template-imports/html/validate', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect(validated.status).toBe(200)
      expect(await validated.json()).toMatchObject({ validation: { normalizedFiles: ['index.html', 'styles.css'] } })
      const uploaded = await adminApp.request('http://127.0.0.1:3001/api/template-imports/html', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect(uploaded.status).toBe(202)
      const result = (await uploaded.json() as { import: { created: boolean; job: { status: string } } }).import
      expect(result).toMatchObject({ created: true, job: { status: 'pending' } })
      const storedVersion = current.database.prepare('SELECT source_digest FROM template_versions LIMIT 1').get() as { source_digest: string }
      const storedPackage = JSON.parse(current.store.read(storedVersion.source_digest).toString('utf8')) as { files: Record<string, string> }
      expect(storedPackage.files['styles.css']).toContain('@scope (html[data-ppt-template-root])')
      expect(storedPackage.files['index.html']).toContain('data-ppt-template-root=""')
      const repeated = await current.imports.importHtml(body)
      expect(repeated).toMatchObject({ created: false, job: { status: 'pending' } })
    } finally { current.database.close(); rmSync(current.root, { recursive: true, force: true }) }
  })

  it('rolls back the catalog index atomically when preview queue registration fails', async () => {
    const current = state()
    try {
      current.database.exec(`CREATE TRIGGER reject_html_preview_job BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT, 'preview queue unavailable'); END`)
      const body = htmlBody('<!doctype html><html><body><h1>原子回滚演练</h1></body></html>', { title: '原子回滚演练' })
      await expect(current.imports.importHtml(body)).rejects.toThrow(/preview queue unavailable/)
      expect(current.database.prepare('SELECT count(*) AS count FROM template_assets').get()).toEqual({ count: 0 })
      expect(current.database.prepare('SELECT count(*) AS count FROM template_versions').get()).toEqual({ count: 0 })
      expect(current.database.prepare('SELECT count(*) AS count FROM content_objects').get()).toEqual({ count: 0 })
      expect(current.database.prepare('SELECT count(*) AS count FROM jobs').get()).toEqual({ count: 0 })
    } finally { current.database.close(); rmSync(current.root, { recursive: true, force: true }) }
  })

  it('exposes upload and status only to an authenticated administrator', async () => {
    const current = state()
    try {
      const zip = await fixtureZip()
      const origin = 'http://127.0.0.1:5173'
      const adminApp = createApp({ auth: createTrustedTestAuth(current.admin), templateImports: current.imports })
      const memberApp = createApp({ auth: createTrustedTestAuth(current.member), templateImports: current.imports })
      expect((await memberApp.request('http://127.0.0.1:3001/api/template-imports', { method: 'POST', headers: { origin, 'content-type': 'application/zip' }, body: zip })).status).toBe(403)
      expect((await adminApp.request('http://127.0.0.1:3001/api/template-imports', { method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: zip })).status).toBe(400)
      const uploaded = await adminApp.request('http://127.0.0.1:3001/api/template-imports', { method: 'POST', headers: { origin, 'content-type': 'application/zip' }, body: zip })
      expect(uploaded.status).toBe(202)
      const result = (await uploaded.json() as { import: { job: { id: string } } }).import
      expect((await adminApp.request(`http://127.0.0.1:3001/api/template-imports/${result.job.id}`)).status).toBe(200)
      expect((await adminApp.request('http://127.0.0.1:3001/api/template-imports/../outside')).status).toBe(404)
    } finally { current.database.close(); rmSync(current.root, { recursive: true, force: true }) }
  })

  it('packages system Chromium and keeps the Web import surface on safe file inputs and PNG previews only', () => {
    const docker = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8')
    expect(docker).toContain('chromium fonts-noto-cjk')
    expect(docker).toContain('CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium')
    const web = [
      'apps/web/src/lib/template-imports.ts',
      'apps/web/src/routes/api/template-imports/+server.ts',
      'apps/web/src/routes/api/template-imports/[jobId]/+server.ts',
      'apps/web/src/routes/(app)/admin/+page.svelte',
    ].map((path) => readFileSync(join(process.cwd(), path), 'utf8')).join('\n')
    expect(web).not.toMatch(/<iframe|srcdoc|\{@html|innerHTML|createObjectURL|file:\/\//i)
    expect(web).toMatch(/\.html,\.htm|\.html\?\$/)
    expect(web).toContain('/api/template-imports/html/validate')
  })
})
