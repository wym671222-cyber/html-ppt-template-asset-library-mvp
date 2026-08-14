import { mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { AssetLibraryCatalog } from '../apps/api/src/assets/library-catalog.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { LocalJobRepository } from '../apps/api/src/jobs/local-jobs.js'
import { PresentationRepository } from '../apps/api/src/presentations/presentation-repository.js'
import { TEMPLATE_PREVIEW_JOB_TYPE, TemplatePreviewJobWorker, type PreviewRenderer } from '../apps/api/src/previews/preview-jobs.js'
import type { SecurePreviewRender } from '../apps/api/src/previews/secure-preview.js'
import { adaptSimulatedTemplatePackage } from '../apps/api/src/templates/simulated-adapter.js'
import { TEST_MEMBER_ID, TEST_USER_ID, seedTestUser } from './p14-test-support.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): { all(...parameters: unknown[]): unknown[]; get(...parameters: unknown[]): unknown; run(...parameters: unknown[]): { changes: number } }
  close(): void
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite
const fixture = join(process.cwd(), 'fixtures/p03-simulated-template')
const origin = 'http://127.0.0.1:5173'

function png(width: number, height: number, marker: number): Buffer {
  const content = Buffer.alloc(25)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(content)
  content.writeUInt32BE(13, 8)
  content.write('IHDR', 12, 'ascii')
  content.writeUInt32BE(width, 16)
  content.writeUInt32BE(height, 20)
  content[24] = marker
  return content
}

function renderer(): PreviewRenderer {
  const diagnostic: SecurePreviewRender['diagnostic'] = {
    allowedRequestCount: 2, blockedRequestCount: 0, blockedSecurityEventCount: 0, cookieHeaderCount: 0, contextCookieCount: 0,
    documentCookiePresent: false, forbiddenDomNodeCount: 0, newWindowCount: 0,
  }
  return { render: async () => ({ previewPng: png(1280, 720, 1), thumbnailPng: png(320, 180, 2), rendererVersion: 'p03-retire-test-renderer', diagnostic }) }
}

async function state() {
  const root = mkdtempSync(join(tmpdir(), 'interactive-template-p03-retire-'))
  const databasePath = join(root, 'asset-library.db')
  migrateDatabase(databasePath)
  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  const admin = seedTestUser(database as never, TEST_USER_ID, 'admin')
  const member = seedTestUser(database as never, TEST_MEMBER_ID, 'member')
  const store = new LocalContentStore(join(root, 'objects'))
  const template = new AssetCatalogRepository(database as never, store).registerTemplate(adaptSimulatedTemplatePackage(fixture))
  const jobs = new LocalJobRepository(database as never)
  jobs.enqueue({ id: 'p03-retire-preview', type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: { templateVersionId: template.versionId, contentObjectDigest: template.contentObject.digest }, inputRevision: 0 })
  await new TemplatePreviewJobWorker(database as never, jobs, store, renderer(), 'p03-retire-worker', 30_000).runOnce()
  const catalog = new AssetLibraryCatalog(database as never, store)
  const auth = {
    authenticate: (cookie: string | null | undefined) => cookie === 'session=admin'
      ? { user: admin, session: { id: 'session-admin', userId: admin.id, createdAt: admin.createdAt, expiresAt: admin.createdAt + 1 } }
      : cookie === 'session=member'
        ? { user: member, session: { id: 'session-member', userId: member.id, createdAt: member.createdAt, expiresAt: member.createdAt + 1 } }
        : null,
    recordFailure: () => undefined,
  }
  return { database, template, app: createApp({ catalog, presentations: new PresentationRepository(database as never), auth: auth as never }) }
}

function headers(role: 'admin' | 'member') { return { origin, cookie: `session=${role}`, 'content-type': 'application/json' } }

describe('P03 catalog detail and administrative retirement', () => {
  it('soft-retires exactly one asset idempotently without deleting fixed presentation references or derivatives', async () => {
    const current = await state()
    try {
      const before = await current.app.request('http://127.0.0.1:3001/api/catalog', { headers: headers('member') })
      expect(await before.json()).toMatchObject({ total: 1, items: [{ version: { isCurrent: true, status: 'verified', contractVersion: 'html-template/v1' }, runtime: null, derivative: { previewUrl: `/api/catalog/assets/${current.template.assetId}/preview`, thumbnailUrl: `/api/catalog/assets/${current.template.assetId}/thumbnail` } }] })

      const create = await current.app.request('http://127.0.0.1:3001/api/presentations', { method: 'POST', headers: headers('member'), body: JSON.stringify({ name: '历史引用' }) })
      const presentation = (await create.json() as { presentation: { id: string; revision: number } }).presentation
      const add = await current.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items`, { method: 'POST', headers: headers('member'), body: JSON.stringify({ templateVersionId: current.template.versionId, expectedRevision: presentation.revision }) })
      expect(add.status).toBe(201)

      const retired = await current.app.request(`http://127.0.0.1:3001/api/admin/templates/${current.template.assetId}/retire`, { method: 'POST', headers: headers('admin'), body: '{}' })
      expect(retired.status).toBe(200)
      expect(await retired.json()).toEqual({ template: { assetId: current.template.assetId, status: 'retired', alreadyRetired: false } })
      const repeated = await current.app.request(`http://127.0.0.1:3001/api/admin/templates/${current.template.assetId}/retire`, { method: 'POST', headers: headers('admin'), body: '{}' })
      expect(await repeated.json()).toEqual({ template: { assetId: current.template.assetId, status: 'retired', alreadyRetired: true } })

      expect(await (await current.app.request('http://127.0.0.1:3001/api/catalog', { headers: headers('member') })).json()).toMatchObject({ total: 0, items: [] })
      const persisted = await current.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}`, { headers: headers('member') })
      expect(await persisted.json()).toMatchObject({ presentation: { items: [{ templateVersionId: current.template.versionId }] } })
      const blockedAdd = await current.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items`, { method: 'POST', headers: headers('member'), body: JSON.stringify({ templateVersionId: current.template.versionId, expectedRevision: 1 }) })
      expect(blockedAdd.status).toBe(409)
      expect(current.database.prepare('SELECT count(*) AS count FROM template_versions').get()).toEqual({ count: 1 })
      expect(current.database.prepare('SELECT count(*) AS count FROM template_preview_derivatives').get()).toEqual({ count: 2 })
      expect(current.database.prepare("SELECT diagnostic FROM audit_events WHERE action = 'admin.template_retire' ORDER BY created_at, id").all()).toEqual([{ diagnostic: 'TEMPLATE_RETIRED' }, { diagnostic: 'ALREADY_RETIRED' }])
    } finally { current.database.close() }
  })

  it('requires the exact authenticated admin POST and rejects non-admin, unknown, malformed, query, body, and method variants', async () => {
    const current = await state()
    try {
      const target = `http://127.0.0.1:3001/api/admin/templates/${current.template.assetId}/retire`
      expect((await current.app.request(target, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })).status).toBe(401)
      expect((await current.app.request(target, { method: 'POST', headers: headers('member'), body: '{}' })).status).toBe(403)
      expect((await current.app.request(`${target}?again=1`, { method: 'POST', headers: headers('admin'), body: '{}' })).status).toBe(400)
      expect((await current.app.request(target, { method: 'POST', headers: { origin, cookie: 'session=admin', 'content-type': 'text/plain' }, body: '{}' })).status).toBe(400)
      expect((await current.app.request(target, { method: 'POST', headers: headers('admin'), body: '{"unexpected":true}' })).status).toBe(400)
      expect((await current.app.request('http://127.0.0.1:3001/api/admin/templates/missing/retire', { method: 'POST', headers: headers('admin'), body: '{}' })).status).toBe(404)
      expect((await current.app.request('http://127.0.0.1:3001/api/admin/templates/file:/retire', { method: 'POST', headers: headers('admin'), body: '{}' })).status).toBe(400)
      expect((await current.app.request(target, { headers: headers('admin') })).status).toBe(404)
    } finally { current.database.close() }
  })
})
