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
import { PreviewArtifactRepository, TemplatePreviewJobWorker, type PreviewRenderer } from '../apps/api/src/previews/preview-jobs.js'
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
const allowlistedV2Digest = 'fb0e964ed926db0c20bb1706044db6e1c52b5ee65dea7d20ae0a3699611e1490'

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

async function interactiveFixtureZip(change?: (manifest: Record<string, unknown>, files: Record<string, string>) => void): Promise<Buffer> {
  const manifest: Record<string, unknown> = {
    contractVersion: 'html-template/v2',
    id: 'simulated-quarterly-brief',
    version: 2,
    title: 'Simulated Quarterly Brief',
    summary: 'A repository-local fixture for validating the v1 HTML template package contract.',
    category: 'report/quarterly',
    tags: ['simulated', 'quarterly', 'brief'],
    entry: 'index.html',
    files: ['styles.css', 'runtime.js', 'index.html'],
    slots: [
      { id: 'title', type: 'text', required: true, maxLength: 120 },
      { id: 'subtitle', type: 'text', required: false, default: 'Repository-local simulation', maxLength: 200 },
      { id: 'accent-color', type: 'color', required: false, default: '#2563eb' },
    ],
    runtime: { viewport: { height: 1080, width: 1920 }, mode: 'sandboxed-js' },
  }
  const files: Record<string, string> = {
    'index.html': `<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main data-template-slot="accent-color"><h1 data-template-slot="title">Interactive fixture</h1><p data-template-slot="subtitle">Repository-local simulation</p><img alt="" src="data:image/png;base64,${onePixelPng}"><button id="advance" type="button">Advance</button></main><script src="runtime.js"></script></body></html>`,
    'runtime.js': `document.querySelector('#advance')?.addEventListener('click', () => document.body.toggleAttribute('data-advanced'))`,
    'styles.css': 'body{margin:0} button{cursor:pointer}',
  }
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

  it('accepts only normalized allowlisted html-template/v2 ZIPs and rejects unsafe package inputs', async () => {
    const parsed = await parseUploadedTemplateZip(await interactiveFixtureZip())
    expect(parsed.version).toMatchObject({
      id: 'simulated-quarterly-brief-v2',
      contractVersion: 'html-template/v2',
      sourceDigest: allowlistedV2Digest,
    })
    expect(parsed.source.manifest).toMatchObject({ runtime: { mode: 'sandboxed-js', viewport: { width: 1920, height: 1080 } } })
    expect(parsed.package.files).toEqual(['index.html', 'runtime.js', 'styles.css'])

    const reordered = await parseUploadedTemplateZip(await interactiveFixtureZip((manifest) => {
      manifest.tags = [...(manifest.tags as string[])].reverse()
      manifest.files = [...(manifest.files as string[])].reverse()
      manifest.slots = [...(manifest.slots as Record<string, unknown>[])]
        .reverse()
        .map((slot) => Object.fromEntries(Object.entries(slot).reverse()))
      const entries = Object.entries(manifest).reverse()
      for (const key of Object.keys(manifest)) delete manifest[key]
      Object.assign(manifest, Object.fromEntries(entries))
    }))
    expect(reordered.version.sourceDigest).toBe(allowlistedV2Digest)

    await expect(parseUploadedTemplateZip(await interactiveFixtureZip((manifest) => {
      manifest.runtime = { mode: 'sandboxed-js', viewport: { width: 1280, height: 720 } }
    }))).rejects.toThrow(/1920x1080/)
    await expect(parseUploadedTemplateZip(await interactiveFixtureZip((_manifest, files) => {
      files['index.html'] = '<!doctype html><html><body><script src="missing.js"></script></body></html>'
    }))).rejects.toThrow(/declared package resource/)
    await expect(parseUploadedTemplateZip(await interactiveFixtureZip((_manifest, files) => {
      files['runtime.js'] = `import './missing.js'`
    }))).rejects.toThrow(/declared package resource/)
    await expect(parseUploadedTemplateZip(await interactiveFixtureZip((manifest, files) => {
      ;(manifest.files as string[]).push('../outside.js')
      files['../outside.js'] = 'document.body.textContent = "outside"'
    }))).rejects.toThrow(/unsafe path/)
    await expect(parseUploadedTemplateZip(await interactiveFixtureZip((_manifest, files) => {
      files['runtime.js'] = `fetch('https://example.test/tracker')`
    }))).rejects.toThrow(/external URL/)
    await expect(parseUploadedTemplateZip(await interactiveFixtureZip((_manifest, files) => {
      files['runtime.js'] += ';document.body.dataset.safe = "changed"'
    }))).rejects.toThrow(/reviewed allowlist/)
    await expect(parseUploadedTemplateZip(await interactiveFixtureZip((_manifest, files) => {
      files['index.html'] = files['index.html'].replace(onePixelPng, 'R0lGODlh')
    }))).rejects.toThrow(/signature|MIME/i)
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

  it('keeps the v1 current version when a v2 candidate preview fails', async () => {
    const current = state()
    try {
      const v1 = await current.imports.importZip(await fixtureZip())
      const renderer: PreviewRenderer = { render: async () => fakeRender() }
      await new TemplatePreviewJobWorker(current.database as never, current.jobs, current.store, renderer, 'pb03-v1-worker', 30_000).runOnce()
      expect(current.imports.job(v1.job.id)).toMatchObject({ status: 'succeeded', available: true })

      const candidate = await current.imports.importZip(await interactiveFixtureZip())
      expect(current.database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(candidate.assetId)).toEqual({ current_version_id: v1.versionId })
      expect(current.database.prepare('SELECT status FROM template_versions WHERE id = ?').get(candidate.versionId)).toEqual({ status: 'verified' })

      await new TemplatePreviewJobWorker(current.database as never, current.jobs, current.store, renderer, 'pb03-v2-worker', 30_000).runOnce()
      expect(current.imports.job(candidate.job.id)).toMatchObject({ status: 'failed', available: false })
      expect(current.database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(candidate.assetId)).toEqual({ current_version_id: v1.versionId })
    } finally { current.database.close(); rmSync(current.root, { recursive: true, force: true }) }
  })

  it('promotes a newer candidate only in the transaction that records both verified derivatives', async () => {
    const current = state()
    try {
      const v1 = await current.imports.importZip(await fixtureZip())
      const candidate = await current.imports.importZip(await interactiveFixtureZip())
      expect(current.database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(candidate.assetId)).toEqual({ current_version_id: v1.versionId })

      const render = fakeRender()
      const preview = current.store.put(render.previewPng, 'image/png')
      const thumbnail = current.store.put(render.thumbnailPng, 'image/png')
      const repository = new PreviewArtifactRepository(current.database as never)
      const v1Source = current.database.prepare('SELECT source_digest FROM template_versions WHERE id = ?').get(v1.versionId) as { source_digest: string }
      expect(() => repository.recordRender({
        templateVersionId: candidate.versionId,
        sourceDigest: v1Source.source_digest,
        preview,
        thumbnail,
        render,
      })).toThrow(/source digest does not match the TemplateVersion/)
      expect(current.database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(candidate.assetId)).toEqual({ current_version_id: v1.versionId })
      expect(current.database.prepare('SELECT count(*) AS count FROM template_preview_derivatives WHERE template_version_id = ?').get(candidate.versionId)).toEqual({ count: 0 })
      expect(current.database.prepare('SELECT count(*) AS count FROM content_objects WHERE digest IN (?, ?)').get(preview.digest, thumbnail.digest)).toEqual({ count: 0 })

      current.database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(preview.digest, preview.mediaType, preview.byteSize, preview.relativePath, Date.now())
      current.database.prepare('INSERT INTO template_preview_derivatives (template_version_id, kind, source_digest, content_digest, renderer_version, security_diagnostic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(candidate.versionId, 'preview', allowlistedV2Digest, preview.digest, render.rendererVersion, JSON.stringify(render.diagnostic), Date.now())
      expect(current.database.prepare('SELECT count(*) AS count FROM template_preview_derivatives WHERE template_version_id = ?').get(candidate.versionId)).toEqual({ count: 1 })
      expect(current.database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(candidate.assetId)).toEqual({ current_version_id: v1.versionId })

      repository.recordRender({
        templateVersionId: candidate.versionId,
        sourceDigest: allowlistedV2Digest,
        preview,
        thumbnail,
        render,
      })
      expect(current.database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(candidate.assetId)).toEqual({ current_version_id: candidate.versionId })
      expect(current.database.prepare('SELECT count(*) AS count FROM template_preview_derivatives WHERE template_version_id = ?').get(candidate.versionId)).toEqual({ count: 2 })

      repository.recordRender({ templateVersionId: v1.versionId, sourceDigest: v1Source.source_digest, preview, thumbnail, render })
      expect(current.database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(candidate.assetId)).toEqual({ current_version_id: candidate.versionId })
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
