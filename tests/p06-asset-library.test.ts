import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { AssetLibraryCatalog, parseCatalogQuery } from '../apps/api/src/assets/library-catalog.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { LocalJobRepository } from '../apps/api/src/jobs/local-jobs.js'
import { TemplatePreviewJobWorker, TEMPLATE_PREVIEW_JOB_TYPE, type PreviewRenderer } from '../apps/api/src/previews/preview-jobs.js'
import type { SecurePreviewRender } from '../apps/api/src/previews/secure-preview.js'
import { adaptSimulatedTemplatePackage } from '../apps/api/src/templates/simulated-adapter.js'
import { catalogQuery, safeDerivativeUrl } from '../apps/web/src/lib/asset-library.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): { all(...parameters: unknown[]): unknown[]; get(...parameters: unknown[]): unknown; run(...parameters: unknown[]): { changes: number } }
  close(): void
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite
const fixture = join(process.cwd(), 'fixtures/p03-simulated-template')

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

function fakeRender(rendererVersion = 'p05-p06-test-renderer'): SecurePreviewRender {
  return {
    previewPng: fakePng(1280, 720, 1),
    thumbnailPng: fakePng(320, 180, 2),
    rendererVersion,
    diagnostic: {
      allowedRequestCount: 2,
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

async function fixtureApp(): Promise<{ app: ReturnType<typeof createApp>; database: SQLite; store: LocalContentStore; assetId: string; versionId: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'asset-library-p06-'))
  const databasePath = join(directory, 'asset-library.db')
  migrateDatabase(databasePath)
  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  const store = new LocalContentStore(join(directory, 'objects'))
  const template = adaptSimulatedTemplatePackage(fixture)
  const registered = new AssetCatalogRepository(database as never, store).registerTemplate(template)
  const jobs = new LocalJobRepository(database as never)
  jobs.enqueue({ id: 'p06-preview', type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: { templateVersionId: template.version.id, contentObjectDigest: registered.contentObject.digest }, inputRevision: 0 })
  const renderer: PreviewRenderer = { render: async () => fakeRender() }
  await new TemplatePreviewJobWorker(database as never, jobs, store, renderer, 'p06-worker', 30_000).runOnce()
  const catalog = new AssetLibraryCatalog(database as never, store)
  return { app: createApp({ catalog }), database, store, assetId: template.asset.id, versionId: template.version.id }
}

describe('P06 bounded deterministic catalog query', () => {
  it('parses only bounded, unique, known parameters', () => {
    expect(parseCatalogQuery('http://127.0.0.1/api/catalog?search=quarterly&category=report%2Fquarterly&tags=brief%2Csimulated&limit=12')).toEqual({
      search: 'quarterly', category: 'report/quarterly', tags: ['brief', 'simulated'], limit: 12,
    })
    expect(() => parseCatalogQuery('http://127.0.0.1/api/catalog?limit=49')).toThrow(/between 1 and 48/)
    expect(() => parseCatalogQuery(`http://127.0.0.1/api/catalog?search=${'x'.repeat(101)}`)).toThrow(/search is invalid/)
    expect(() => parseCatalogQuery('http://127.0.0.1/api/catalog?tags=a,b,c,d,e,f')).toThrow(/at most five/)
    expect(() => parseCatalogQuery('http://127.0.0.1/api/catalog?tags=a,a')).toThrow(/unique/)
    expect(() => parseCatalogQuery('http://127.0.0.1/api/catalog?tags=a,,b')).toThrow(/empty values/)
    expect(() => parseCatalogQuery('http://127.0.0.1/api/catalog?search=a&search=b')).toThrow(/must not repeat/)
    expect(() => parseCatalogQuery('http://127.0.0.1/api/catalog?digest=' + 'a'.repeat(64))).toThrow(/Unknown/)
  })

  it('builds same-origin queries and rejects untrusted derivative URLs', () => {
    expect(catalogQuery({ search: ' quarterly ', category: 'report/quarterly', tags: ['simulated', 'brief'] })).toBe('/api/catalog?search=quarterly&category=report%2Fquarterly&tags=brief%2Csimulated')
    expect(safeDerivativeUrl('/api/catalog/assets/simulated-quarterly-brief/preview')).toContain('/preview')
    for (const value of ['https://example.test/a.png', 'file:///tmp/a.png', 'blob:http://127.0.0.1/id', '/api/catalog/assets/' + 'a'.repeat(64)]) {
      expect(() => safeDerivativeUrl(value)).toThrow(/unsafe/)
    }
  })
})

describe('P06 read-only catalog API and PNG trust boundary', () => {
  it('returns only the active verified current version with a same-renderer P05 pair in stable JSON', async () => {
    const state = await fixtureApp()
    try {
      const incompletePreview = state.store.put(fakePng(1280, 720, 3), 'image/png')
      state.database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(
        incompletePreview.digest, incompletePreview.mediaType, incompletePreview.byteSize, incompletePreview.relativePath, Date.now(),
      )
      state.database.prepare(`
        INSERT INTO template_preview_derivatives (template_version_id, kind, source_digest, content_digest, renderer_version, security_diagnostic, created_at)
        SELECT template_version_id, kind, source_digest, ?, 'p05-newer-incomplete', security_diagnostic, created_at + 1000
        FROM template_preview_derivatives WHERE kind = 'preview'
      `).run(incompletePreview.digest)
      const response = await state.app.request('http://127.0.0.1:3001/api/catalog', { headers: { origin: 'http://127.0.0.1:5173' } })
      expect(response.status).toBe(200)
      const body = await response.json() as { items: Array<Record<string, unknown>>; facets: { categories: string[]; tags: string[] }; total: number; owner: string }
      expect(body).toMatchObject({ owner: 'local-owner', total: 1, facets: { categories: ['report/quarterly'], tags: ['brief', 'quarterly', 'simulated'] } })
      expect(body.items[0]).toMatchObject({
        id: state.assetId,
        title: 'Simulated Quarterly Brief',
        version: { id: state.versionId, number: 1, status: 'verified', contractVersion: 'html-template/v1' },
        derivative: { rendererVersion: 'p05-p06-test-renderer' },
      })
      expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{64}|relative_path|file:|https?:\/\//)

      for (const query of ['search=Quarterly', 'category=report%2Fquarterly', 'tags=brief%2Csimulated']) {
        const filtered = await state.app.request(`http://127.0.0.1:3001/api/catalog?${query}`)
        expect((await filtered.json() as { total: number }).total).toBe(1)
      }
      const none = await state.app.request('http://127.0.0.1:3001/api/catalog?search=missing')
      expect(await none.json()).toMatchObject({ items: [], total: 0 })
      for (const search of ['%25', "'%20OR%201%3D1%20--"]) {
        const literal = await state.app.request(`http://127.0.0.1:3001/api/catalog?search=${search}`)
        expect(await literal.json()).toMatchObject({ items: [], total: 0 })
      }

      state.database.prepare("UPDATE template_assets SET status = 'retired' WHERE id = ?").run(state.assetId)
      const retired = await state.app.request('http://127.0.0.1:3001/api/catalog')
      expect(await retired.json()).toMatchObject({ items: [], total: 0 })
    } finally {
      state.database.close()
    }
  })

  it('streams only registered PNG bytes by asset identity and rejects digest, path, URL, HTML, missing and tampered inputs', async () => {
    const state = await fixtureApp()
    try {
      const preview = await state.app.request(`http://127.0.0.1:3001/api/catalog/assets/${state.assetId}/preview`)
      expect(preview.status).toBe(200)
      expect(preview.headers.get('content-type')).toBe('image/png')
      expect(preview.headers.get('cache-control')).toBe('no-store')
      expect(Buffer.from(await preview.arrayBuffer())).toEqual(fakeRender().previewPng)

      const thumbnail = await state.app.request(`http://127.0.0.1:3001/api/catalog/assets/${state.assetId}/thumbnail`)
      expect(thumbnail.status).toBe(200)
      expect(Buffer.from(await thumbnail.arrayBuffer())).toEqual(fakeRender().thumbnailPng)

      expect((await state.app.request('http://127.0.0.1:3001/api/catalog/assets/file:/preview')).status).toBe(400)
      expect((await state.app.request('http://127.0.0.1:3001/api/catalog/assets/missing/preview')).status).toBe(404)
      expect((await state.app.request(`http://127.0.0.1:3001/api/catalog/assets/${state.assetId}/preview?url=https://example.test/x`)).status).toBe(400)
      expect((await state.app.request(`http://127.0.0.1:3001/api/catalog/derivatives/${'a'.repeat(64)}`)).status).toBe(404)
      expect((await state.app.request(`http://127.0.0.1:3001/api/catalog/assets/${state.assetId}/html`)).status).toBe(404)
      expect((await state.app.request('http://127.0.0.1:3001/api/preview')).status).toBe(404)

      const derivative = state.database.prepare("SELECT content_digest FROM template_preview_derivatives WHERE kind = 'preview'").get() as { content_digest: string }
      const object = state.database.prepare('SELECT relative_path FROM content_objects WHERE digest = ?').get(derivative.content_digest) as { relative_path: string }
      writeFileSync(join(state.store.root, object.relative_path), 'tampered')
      const tampered = await state.app.request(`http://127.0.0.1:3001/api/catalog/assets/${state.assetId}/preview`)
      expect(tampered.status).toBe(409)
      expect(await tampered.json()).toEqual({ error: 'Registered derivative integrity check failed' })
    } finally {
      state.database.close()
    }
  })

  it('keeps loopback Owner/Origin defenses and legacy capabilities unreachable', async () => {
    const state = await fixtureApp()
    try {
      expect((await state.app.request('http://example.test/api/catalog')).status).toBe(421)
      expect((await state.app.request('http://127.0.0.1:3001/api/catalog', { headers: { origin: 'https://example.test' } })).status).toBe(403)
      for (const path of ['/api/auth/login', '/api/admin/users', '/api/decks/x/share', '/api/providers', '/api/export', '/api/search']) {
        expect((await state.app.request(`http://127.0.0.1:3001${path}`)).status).toBe(404)
      }
    } finally {
      state.database.close()
    }
  })
})

describe('P06 schema and Web execution boundary', () => {
  it('requires no migration and preserves SQLite integrity on repeated migration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'asset-library-p06-schema-'))
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
      expect(database.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: 4 })
    } finally {
      database.close()
    }
  })

  it('does not inject or execute template HTML in the P06 Web surface', () => {
    const paths = [
      'apps/web/src/routes/(app)/+page.svelte',
      'apps/web/src/lib/components/library/AssetCard.svelte',
      'apps/web/src/lib/components/library/AssetDetail.svelte',
      'apps/web/src/lib/asset-library.ts',
    ]
    const source = paths.map((path) => readFileSync(join(process.cwd(), path), 'utf8')).join('\n')
    expect(source).not.toMatch(/<iframe|srcdoc|\{@html|innerHTML|blob:|createObjectURL|file:\/\//i)
    expect(source).not.toMatch(/https?:\/\//i)
  })
})
