import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { assertSafeExportHtml, PresentationExportRepository } from '../apps/api/src/presentation-exports/presentation-export-repository.js'
import { assertSafeExportPath, createStoredZip, readStoredZip, sha256 } from '../apps/api/src/presentation-exports/offline-archive.js'
import { PresentationRepository } from '../apps/api/src/presentations/presentation-repository.js'
import { adaptSimulatedTemplatePackage } from '../apps/api/src/templates/simulated-adapter.js'
import { getOwnerContext } from '../apps/api/src/owner.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): { all(...parameters: unknown[]): unknown[]; get(...parameters: unknown[]): unknown; run(...parameters: unknown[]): { changes: number } }
  close(): void
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite

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

function fixture(): {
  directory: string
  database: SQLite
  store: LocalContentStore
  presentations: PresentationRepository
  exports: PresentationExportRepository
  templateVersionId: string
  assetId: string
  sourceDigest: string
} {
  const directory = mkdtempSync(join(tmpdir(), 'asset-library-p08-'))
  const databasePath = join(directory, 'asset-library.db')
  migrateDatabase(databasePath)
  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  const store = new LocalContentStore(join(directory, 'objects'))
  const template = adaptSimulatedTemplatePackage(join(process.cwd(), 'fixtures/p03-simulated-template'))
  const registered = new AssetCatalogRepository(database as never, store).registerTemplate(template)
  const now = Date.now()
  const derivatives = [
    { kind: 'preview', object: store.put(fakePng(1280, 720, 1), 'image/png') },
    { kind: 'thumbnail', object: store.put(fakePng(320, 180, 2), 'image/png') },
  ] as const
  for (const derivative of derivatives) {
    database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(derivative.object.digest, derivative.object.mediaType, derivative.object.byteSize, derivative.object.relativePath, now)
    database.prepare('INSERT INTO template_preview_derivatives (template_version_id, kind, source_digest, content_digest, renderer_version, security_diagnostic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(template.version.id, derivative.kind, template.version.sourceDigest, derivative.object.digest, 'p08-fixture-renderer', '{}', now)
  }
  return {
    directory,
    database,
    store,
    presentations: new PresentationRepository(database as never),
    exports: new PresentationExportRepository(database as never, store),
    templateVersionId: template.version.id,
    assetId: template.asset.id,
    sourceDigest: registered.sourceDigest,
  }
}

function preparedPresentation(state: ReturnType<typeof fixture>, name = 'P08 Offline Brief') {
  const owner = getOwnerContext()
  const created = state.presentations.create(owner, name)
  const added = state.presentations.add(owner, created.id, state.templateVersionId, created.revision)
  return state.presentations.reviseOverrides(owner, added.id, added.items[0].id, { title: 'Audited & verified', 'accent-color': '#123abc' }, added.revision)
}

function protectedState(database: SQLite): string {
  const tables = ['presentations', 'presentation_items', 'template_assets', 'template_versions', 'template_preview_derivatives']
  return JSON.stringify(Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
}

describe('P08 fixed revision HTML/ZIP export', () => {
  it('persists an immutable audited manifest and re-verifies controlled HTML/ZIP files without changing P04-P07 state', () => {
    const state = fixture()
    try {
      const owner = getOwnerContext()
      const presentation = preparedPresentation(state)
      const protectedBefore = protectedState(state.database)
      const sourceBefore = Buffer.from(state.store.read(state.sourceDigest))
      const created = state.exports.create(owner, presentation.id, presentation.revision, presentation.items.map((item) => item.id))
      expect(created.created).toBe(true)
      expect(created.manifest).toMatchObject({
        contractVersion: 'html-presentation-export/v1',
        owner: 'local-owner',
        presentation: { id: presentation.id, revision: presentation.revision },
        items: [{ itemId: presentation.items[0].id, position: 0, templateVersionId: state.templateVersionId, source: { sourceSha256: state.sourceDigest, contentObjectSha256: state.sourceDigest }, slotOverrides: { 'accent-color': '#123abc', title: 'Audited & verified' } }],
      })
      expect(created.manifest.package.zipSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(created.manifest.package.files.map((file) => file.relativePath)).toEqual(['index.html', 'assets/slide-0001-thumbnail.png', 'manifest.json'])

      const html = state.exports.readArtifact(owner, presentation.id, created.summary.id, 'html')
      expect(sha256(html)).toBe(created.manifest.package.htmlSha256)
      expect(html.toString()).toContain('Audited &amp; verified')
      expect(html.toString()).toContain('border-top-color:#123abc')
      expect(html.toString()).not.toMatch(/<(?:script|iframe|form)\b|https?:|file:|data:|blob:/i)

      const zip = state.exports.readArtifact(owner, presentation.id, created.summary.id, 'zip')
      expect(sha256(zip)).toBe(created.manifest.package.zipSha256)
      const zipPath = join(state.directory, 'verified-export.zip')
      writeFileSync(zipPath, zip)
      expect(execFileSync('/usr/bin/unzip', ['-t', zipPath], { encoding: 'utf8' })).toContain('No errors detected')
      const entries = readStoredZip(zip)
      expect([...entries.keys()]).toEqual(created.manifest.package.files.map((file) => file.relativePath))
      for (const file of created.manifest.package.files) expect(sha256(entries.get(file.relativePath)!)).toBe(file.sha256)
      expect(state.exports.readManifest(owner, presentation.id, created.summary.id)).toEqual(created.manifest)
      expect(state.exports.list(owner, presentation.id)).toEqual([created.summary])

      const repeated = state.exports.create(owner, presentation.id, presentation.revision, presentation.items.map((item) => item.id))
      expect(repeated).toMatchObject({ created: false, summary: { id: created.summary.id } })
      expect(state.database.prepare('SELECT count(*) AS count FROM presentation_exports').get()).toEqual({ count: 1 })
      expect(protectedState(state.database)).toBe(protectedBefore)
      expect(state.store.read(state.sourceDigest)).toEqual(sourceBefore)

      state.database.prepare('UPDATE template_assets SET current_version_id = NULL WHERE id = ?').run(state.assetId)
      expect(state.exports.readManifest(owner, presentation.id, created.summary.id)).toEqual(created.manifest)
    } finally { state.database.close() }
  })

  it('rejects stale, unknown, cross-Presentation, unavailable and tampered inputs without a published or partial export', () => {
    const owner = getOwnerContext()
    const state = fixture()
    try {
      const presentation = preparedPresentation(state, 'First')
      const second = preparedPresentation(state, 'Second')
      const before = {
        exports: state.database.prepare('SELECT count(*) AS count FROM presentation_exports').get(),
        objects: state.database.prepare('SELECT count(*) AS count FROM content_objects').get(),
        protected: protectedState(state.database),
      }
      const failures: Array<() => unknown> = [
        () => state.exports.create(owner, presentation.id, presentation.revision - 1, [presentation.items[0].id]),
        () => state.exports.create(owner, presentation.id, presentation.revision, ['item-unknown']),
        () => state.exports.create(owner, presentation.id, presentation.revision, [second.items[0].id]),
        () => state.exports.create(owner, presentation.id, presentation.revision, []),
        () => state.exports.create(owner, presentation.id, presentation.revision, [presentation.items[0].id, presentation.items[0].id]),
      ]
      for (const failure of failures) expect(failure).toThrow()
      expect(state.database.prepare('SELECT count(*) AS count FROM presentation_exports').get()).toEqual(before.exports)
      expect(state.database.prepare('SELECT count(*) AS count FROM content_objects').get()).toEqual(before.objects)
      expect(protectedState(state.database)).toBe(before.protected)

      state.database.prepare('UPDATE template_assets SET current_version_id = NULL WHERE id = ?').run(state.assetId)
      state.database.prepare("UPDATE template_versions SET status = 'unavailable' WHERE id = ?").run(state.templateVersionId)
      expect(() => state.exports.create(owner, presentation.id, presentation.revision, [presentation.items[0].id])).toThrow(/unavailable/)
      expect(state.database.prepare('SELECT count(*) AS count FROM presentation_exports').get()).toEqual({ count: 0 })
    } finally { state.database.close() }

    const tampered = fixture()
    try {
      const presentation = preparedPresentation(tampered)
      const sourcePath = join(tampered.store.root, tampered.store.relativePathFor(tampered.sourceDigest))
      writeFileSync(sourcePath, '{"manifest":{"entry":"../outside"}}')
      const objectCount = tampered.database.prepare('SELECT count(*) AS count FROM content_objects').get()
      expect(() => tampered.exports.create(owner, presentation.id, presentation.revision, [presentation.items[0].id])).toThrow(/integrity check failed/)
      expect(tampered.database.prepare('SELECT count(*) AS count FROM presentation_exports').get()).toEqual({ count: 0 })
      expect(tampered.database.prepare('SELECT count(*) AS count FROM content_objects').get()).toEqual(objectCount)
    } finally { tampered.database.close() }
  })

  it('enforces allowlisted relative ZIP paths and rejects active, external, parent and file URL HTML', () => {
    for (const path of ['/absolute.html', '../outside.html', 'folder/../../outside', 'file:secret', 'folder\\secret']) expect(() => assertSafeExportPath(path)).toThrow(/allowlisted/)
    expect(() => createStoredZip([{ relativePath: 'index.html', content: Buffer.from('one') }, { relativePath: 'index.html', content: Buffer.from('two') }])).toThrow(/duplicate/)
    const allowed = new Set(['assets/slide-0001-thumbnail.png'])
    for (const html of [
      '<script>alert(1)</script>', '<iframe src="assets/slide-0001-thumbnail.png"></iframe>', '<form></form>',
      '<img src="https://example.test/x">', '<img src="file:///tmp/x">', '<img src="../x">', '<img src="missing.png">',
    ]) expect(() => assertSafeExportHtml(html, allowed)).toThrow()
  })
})

describe('P08 API and migration boundary', () => {
  it('adds numbered append-only export schema and keeps empty/existing migration integrity', () => {
    const directory = mkdtempSync(join(tmpdir(), 'asset-library-p08-migration-'))
    const path = join(directory, 'asset-library.db')
    migrateDatabase(path)
    const repeated = migrateDatabase(path)
    expect(repeated.backupPath && existsSync(repeated.backupPath)).toBe(true)
    const database = new Database(path)
    try {
      database.pragma('foreign_keys = ON')
      expect(database.pragma('quick_check', { simple: true })).toBe('ok')
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(database.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: 6 })
      expect(database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'presentation_exports_%'").get()).toEqual({ count: 4 })
    } finally { database.close() }
  })

  it('exposes only bounded local export routes and returns JSON, HTML and ZIP with safe media types', async () => {
    const state = fixture()
    try {
      const presentation = preparedPresentation(state)
      const app = createApp({ presentations: state.presentations, exports: state.exports })
      const url = `http://127.0.0.1:3001/api/presentations/${presentation.id}/exports`
      const create = await app.request(url, { method: 'POST', body: JSON.stringify({ expectedRevision: presentation.revision, itemIds: presentation.items.map((item) => item.id) }) })
      expect(create.status).toBe(201)
      const payload = await create.json() as { export: { id: string } }
      expect((await app.request(url)).status).toBe(200)
      expect((await app.request(`${url}/${payload.export.id}/manifest`)).headers.get('content-type')).toMatch(/^application\/json/)
      expect((await app.request(`${url}/${payload.export.id}/html`)).headers.get('content-type')).toMatch(/^text\/html/)
      expect((await app.request(`${url}/${payload.export.id}/zip`)).headers.get('content-type')).toBe('application/zip')

      for (const request of [
        app.request(url, { method: 'POST', body: '{' }),
        app.request(url, { method: 'POST', body: JSON.stringify({ expectedRevision: presentation.revision, itemIds: [presentation.items[0].id], extra: true }) }),
        app.request(url, { method: 'POST', body: JSON.stringify({ expectedRevision: presentation.revision - 1, itemIds: [presentation.items[0].id] }) }),
        app.request(`${url}?file=../outside`, { method: 'POST', body: JSON.stringify({ expectedRevision: presentation.revision, itemIds: [presentation.items[0].id] }) }),
      ]) expect([400, 409]).toContain((await request).status)
      expect((await app.request(`http://example.test/api/presentations/${presentation.id}/exports`)).status).toBe(421)
      expect((await app.request(url, { headers: { origin: 'https://example.test' } })).status).toBe(403)
      for (const path of ['/api/export', '/api/preview', '/api/auth/login', '/api/admin/users', '/api/search']) expect((await app.request(`http://127.0.0.1:3001${path}`)).status).toBe(404)
    } finally { state.database.close() }
  })

  it('rejects a malformed stored audit manifest with a bounded diagnostic', () => {
    const state = fixture()
    try {
      const owner = getOwnerContext()
      const presentation = state.presentations.create(owner, 'Malformed manifest')
      const html = state.store.put(Buffer.from('<!doctype html><html><body>safe</body></html>'), 'text/html; charset=utf-8')
      const zip = state.store.put(createStoredZip([{ relativePath: 'index.html', content: Buffer.from('<!doctype html><html><body>safe</body></html>') }]), 'application/zip')
      const manifest = state.store.put(Buffer.from('{'), 'application/vnd.html-presentation-export-manifest+json')
      for (const object of [html, zip, manifest]) state.database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(object.digest, object.mediaType, object.byteSize, object.relativePath, Date.now())
      state.database.prepare('INSERT INTO presentation_exports (id, presentation_id, presentation_revision, manifest_digest, html_digest, zip_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('export-malformed', presentation.id, 0, manifest.digest, html.digest, zip.digest, 1)
      expect(() => state.exports.readManifest(owner, presentation.id, 'export-malformed')).toThrow(/manifest is malformed/)
    } finally { state.database.close() }
  })
})
