import { existsSync, mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { PresentationRepository } from '../apps/api/src/presentations/presentation-repository.js'
import { adaptSimulatedTemplatePackage } from '../apps/api/src/templates/simulated-adapter.js'
import { getOwnerContext } from '../apps/api/src/owner.js'

type SQLite = { pragma(statement: string): unknown; prepare(statement: string): { get(...parameters: unknown[]): unknown; run(...parameters: unknown[]): { changes: number }; all(...parameters: unknown[]): unknown[] }; close(): void }
const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite

function fixture(): { database: SQLite; repository: PresentationRepository; templateVersionId: string; assetId: string } {
  const directory = mkdtempSync(join(tmpdir(), 'asset-library-p07-'))
  const path = join(directory, 'asset-library.db')
  migrateDatabase(path)
  const database = new Database(path)
  database.pragma('foreign_keys = ON')
  const template = adaptSimulatedTemplatePackage(join(process.cwd(), 'fixtures/p03-simulated-template'))
  new AssetCatalogRepository(database as never, new LocalContentStore(join(directory, 'objects'))).registerTemplate(template)
  const now = Date.now()
  for (const kind of ['preview', 'thumbnail']) {
    const digest = kind === 'preview' ? 'a'.repeat(64) : 'b'.repeat(64)
    database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(digest, 'image/png', 1, `objects/${digest}.png`, now)
    database.prepare('INSERT INTO template_preview_derivatives (template_version_id, kind, source_digest, content_digest, renderer_version, security_diagnostic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(template.version.id, kind, template.version.sourceDigest, digest, 'p07-test', '{}', now)
  }
  return { database, repository: new PresentationRepository(database as never), templateVersionId: template.version.id, assetId: template.asset.id }
}

describe('P07 presentation persistence and revision CAS', () => {
  it('applies the numbered migration once and keeps repeated target migration healthy', () => {
    const directory = mkdtempSync(join(tmpdir(), 'asset-library-p07-migration-'))
    const path = join(directory, 'asset-library.db')
    migrateDatabase(path)
    const repeated = migrateDatabase(path)
    expect(repeated.backupPath && existsSync(repeated.backupPath)).toBe(true)
    const database = new Database(path)
    try {
      expect(database.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: 4 })
      expect(database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name IN ('presentation_items_position_fixed', 'presentation_items_non_last_delete_forbidden')").get()).toEqual({ count: 0 })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { database.close() }
  })

  it('creates, fixes the catalog version, maintains continuous positions, and advances revision once per successful write', () => {
    const state = fixture()
    try {
      const owner = getOwnerContext()
      const created = state.repository.create(owner, 'Q3 汇报')
      const added = state.repository.add(owner, created.id, state.templateVersionId, created.revision)
      expect(added).toMatchObject({ revision: 1, items: [{ position: 0, templateVersionId: state.templateVersionId }] })
      const revised = state.repository.reviseOverrides(owner, added.id, added.items[0].id, { title: '受控标题', 'accent-color': '#2563eb' }, added.revision)
      expect(revised).toMatchObject({ revision: 2, items: [{ slotOverrides: { title: '受控标题', 'accent-color': '#2563eb' } }] })
      const copied = state.repository.copy(owner, revised.id, revised.items[0].id, revised.revision, 0)
      expect(copied).toMatchObject({ revision: 3, items: [{ position: 0 }, { position: 1 }] })
      const moved = state.repository.move(owner, copied.id, copied.items[1].id, 0, copied.revision)
      expect(moved.items.map((item) => item.position)).toEqual([0, 1])
      const deleted = state.repository.remove(owner, moved.id, moved.items[0].id, moved.revision)
      expect(deleted).toMatchObject({ revision: 5, items: [{ position: 0, templateVersionId: state.templateVersionId }] })
      const renamed = state.repository.rename(owner, deleted.id, 'Q3 更新', deleted.revision)
      expect(renamed).toMatchObject({ name: 'Q3 更新', revision: 6 })
      expect(() => state.repository.add(owner, renamed.id, state.templateVersionId, deleted.revision)).toThrow(/changed/)
      expect(state.repository.read(owner, renamed.id)).toMatchObject({ revision: 6, items: [{ position: 0 }] })
    } finally { state.database.close() }
  })

  it('rejects retired/current-version drift, cross-presentation items, invalid positions and unsafe overrides without partial writes', () => {
    const state = fixture()
    try {
      const owner = getOwnerContext()
      const first = state.repository.create(owner, 'One')
      const second = state.repository.create(owner, 'Two')
      const added = state.repository.add(owner, first.id, state.templateVersionId, first.revision)
      const revision = added.revision
      for (const overrides of [{ title: '<img>' }, { title: 'javascript:alert(1)' }, { title: '../secret' }, { unknown: 'blocked' }, { 'accent-color': 'red' }, { title: 42 }]) {
        expect(() => state.repository.reviseOverrides(owner, first.id, added.items[0].id, overrides, revision)).toThrow()
      }
      expect(() => state.repository.move(owner, first.id, added.items[0].id, 3, revision)).toThrow(/position/)
      expect(() => state.repository.copy(owner, second.id, added.items[0].id, second.revision)).toThrow(/not found/)
      expect(state.repository.read(owner, first.id)).toMatchObject({ revision, items: [{ position: 0, slotOverrides: {} }] })
      state.database.prepare("UPDATE template_assets SET status = 'retired' WHERE id = ?").run(state.assetId)
      expect(() => state.repository.add(owner, first.id, state.templateVersionId, revision)).toThrow(/not an active catalog selection/)
      expect(state.repository.read(owner, first.id)).toMatchObject({ revision, items: [{ position: 0 }] })
    } finally { state.database.close() }
  })

  it('exposes bounded JSON API routes while preserving loopback and legacy route rejection', async () => {
    const state = fixture()
    try {
      const app = createApp({ presentations: state.repository })
      const create = await app.request('http://127.0.0.1:3001/api/presentations', { method: 'POST', body: JSON.stringify({ name: 'API 汇报' }) })
      expect(create.status).toBe(201)
      const presentation = (await create.json() as { presentation: { id: string; revision: number } }).presentation
      const add = await app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items`, { method: 'POST', body: JSON.stringify({ templateVersionId: state.templateVersionId, expectedRevision: 0 }) })
      expect(add.status).toBe(201)
      const item = (await add.json() as { presentation: { items: Array<{ id: string }> } }).presentation.items[0]
      expect((await app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 0, position: 0 }) })).status).toBe(409)
      for (const request of [
        app.request('http://127.0.0.1:3001/api/presentations', { method: 'POST', body: '{' }),
        app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 1, position: 0, slotOverrides: {} }) }),
        app.request('http://127.0.0.1:3001/api/presentations', { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(121) }) }),
      ]) expect((await request).status).toBe(400)
      expect((await app.request('http://example.test/api/presentations')).status).toBe(421)
      expect((await app.request('http://127.0.0.1:3001/api/presentations', { headers: { origin: 'https://example.test' } })).status).toBe(403)
      for (const path of ['/api/auth/login', '/api/admin/users', '/api/decks/x/lock', '/api/preview', '/api/export', '/api/search']) expect((await app.request(`http://127.0.0.1:3001${path}`)).status).toBe(404)
    } finally { state.database.close() }
  })
})
