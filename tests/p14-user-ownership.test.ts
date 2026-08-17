import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { AssetLibraryCatalog } from '../apps/api/src/assets/library-catalog.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { hashPassword } from '../apps/api/src/auth/password.js'
import { AuthApplicationService } from '../apps/api/src/auth/service.js'
import { SessionRepository, type CreatedSession } from '../apps/api/src/auth/sessions.js'
import { UserRepository } from '../apps/api/src/auth/users.js'
import { migrateDatabase, TARGET_DATABASE_TRIGGERS } from '../apps/api/src/db/migrate.js'
import { MIGRATIONS_DIRECTORY } from '../apps/api/src/db/paths.js'
import { getOwnerContext } from '../apps/api/src/owner.js'
import { PresentationExportRepository } from '../apps/api/src/presentation-exports/presentation-export-repository.js'
import { readStoredZip } from '../apps/api/src/presentation-exports/offline-archive.js'
import { PresentationRepository } from '../apps/api/src/presentations/presentation-repository.js'
import { LocalRecoveryService } from '../apps/api/src/recovery/local-recovery.js'
import { adaptSimulatedTemplatePackage } from '../apps/api/src/templates/simulated-adapter.js'

type Statement = {
  all(...parameters: unknown[]): unknown[]
  get(...parameters: unknown[]): unknown
  run(...parameters: unknown[]): { changes: number }
}
type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): Statement
  exec(statement: string): void
  close(): void
}

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url))
const Database = apiRequire('better-sqlite3') as new (path: string, options?: { readonly?: boolean; fileMustExist?: boolean }) => SQLite
const drizzle = (apiRequire('drizzle-orm/better-sqlite3') as { drizzle(database: SQLite): unknown }).drizzle
const drizzleMigrate = (apiRequire('drizzle-orm/better-sqlite3/migrator') as { migrate(database: unknown, options: { migrationsFolder: string }): void }).migrate

const temporaryRoots: string[] = []
const secureDiagnostic = JSON.stringify({
  allowedRequestCount: 2,
  blockedRequestCount: 0,
  blockedSecurityEventCount: 0,
  cookieHeaderCount: 0,
  contextCookieCount: 0,
  documentCookiePresent: false,
  forbiddenDomNodeCount: 0,
  newWindowCount: 0,
})

function temporaryRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `asset-library-p14-${label}-`))
  temporaryRoots.push(root)
  return root
}

function openDatabase(path: string): SQLite {
  const database = new Database(path)
  database.pragma('foreign_keys = ON')
  return database
}

function scalar(database: SQLite, sql: string): number {
  return (database.prepare(sql).get() as { count: number }).count
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

function createSixMigrationDatabase(path: string): void {
  const migrations = join(temporaryRoot('six-migrations'), 'drizzle')
  mkdirSync(join(migrations, 'meta'), { recursive: true })
  for (let index = 0; index < 6; index += 1) {
    const prefix = String(index).padStart(4, '0')
    const source = readdirSync(MIGRATIONS_DIRECTORY).find((name) => name.startsWith(`${prefix}_`) && name.endsWith('.sql'))
    if (!source) throw new Error(`Missing migration fixture ${prefix}`)
    cpSync(join(MIGRATIONS_DIRECTORY, source), join(migrations, source))
  }
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIRECTORY, 'meta/_journal.json'), 'utf8')) as { entries: unknown[] }
  writeFileSync(join(migrations, 'meta/_journal.json'), `${JSON.stringify({ ...journal, entries: journal.entries.slice(0, 6) }, null, 2)}\n`)
  mkdirSync(dirname(path), { recursive: true })
  const database = openDatabase(path)
  try { drizzleMigrate(drizzle(database), { migrationsFolder: migrations }) } finally { database.close() }
}

type BusinessFixture = Awaited<ReturnType<typeof businessFixture>>

async function businessFixture() {
  const root = temporaryRoot('business')
  const databasePath = join(root, 'asset-library.db')
  const contentRoot = join(root, 'objects')
  const backupRoot = join(root, 'backups')
  const restoreRoot = join(root, 'restores')
  migrateDatabase(databasePath)
  const database = openDatabase(databasePath)
  const passwordHash = await hashPassword('ownership-test-password')
  const users = new UserRepository(database as never)
  const admin = users.create({ username: 'admin', passwordHash, role: 'admin', status: 'active' })
  const memberA = users.create({ username: 'member.a', passwordHash, role: 'member', status: 'active' })
  const memberB = users.create({ username: 'member.b', passwordHash, role: 'member', status: 'active' })
  const forced = users.create({ username: 'forced', passwordHash, role: 'member', status: 'active', mustChangePassword: true })
  const sessions = new SessionRepository(database as never)
  const authenticated = {
    admin: sessions.create(admin.id),
    memberA: sessions.create(memberA.id),
    memberB: sessions.create(memberB.id),
    forced: sessions.create(forced.id),
  }

  const store = new LocalContentStore(contentRoot)
  const template = adaptSimulatedTemplatePackage(join(process.cwd(), 'fixtures/p03-simulated-template'))
  const registered = new AssetCatalogRepository(database as never, store).registerTemplate(template)
  const now = Date.now()
  for (const derivative of [
    { kind: 'preview', object: store.put(fakePng(1280, 720, 1), 'image/png') },
    { kind: 'thumbnail', object: store.put(fakePng(320, 180, 2), 'image/png') },
  ] as const) {
    database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(
      derivative.object.digest, derivative.object.mediaType, derivative.object.byteSize, derivative.object.relativePath, now,
    )
    database.prepare('INSERT INTO template_preview_derivatives (template_version_id, kind, source_digest, content_digest, renderer_version, security_diagnostic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      template.version.id, derivative.kind, registered.sourceDigest, derivative.object.digest, 'p14-fixture-renderer', secureDiagnostic, now,
    )
  }

  const presentations = new PresentationRepository(database as never)
  const exports = new PresentationExportRepository(database as never, store)
  const recovery = new LocalRecoveryService({ databasePath, contentRoot, backupRoot, restoreRoot })
  const auth = new AuthApplicationService(database as never)
  const app = createApp({ catalog: new AssetLibraryCatalog(database as never, store), presentations, exports, recovery, auth })
  return { root, databasePath, contentRoot, backupRoot, restoreRoot, database, store, template, users: { admin, memberA, memberB, forced }, authenticated, presentations, exports, recovery, app }
}

function cookie(session: CreatedSession): Record<string, string> {
  return { cookie: session.cookie.split(';', 1)[0] }
}

function writeHeaders(session: CreatedSession): Record<string, string> {
  return { ...cookie(session), origin: 'http://127.0.0.1:5173' }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('P14 authenticated user ownership', () => {
  it('shares catalog and PNG while isolating full Presentation, Item and Export CRUD for members and admins', async () => {
    const state = await businessFixture()
    try {
      expect((await state.app.request('http://127.0.0.1:3001/api/catalog')).status).toBe(401)
      expect((await state.app.request('http://127.0.0.1:3001/api/catalog', { headers: cookie(state.authenticated.forced) })).status).toBe(403)
      expect((await state.app.request('http://127.0.0.1:3001/api/presentations')).status).toBe(401)
      expect((await state.app.request('http://127.0.0.1:3001/api/presentations', { headers: cookie(state.authenticated.forced) })).status).toBe(403)

      const catalogs = await Promise.all([state.authenticated.memberA, state.authenticated.memberB].map(async (session) => {
        const response = await state.app.request('http://127.0.0.1:3001/api/catalog', { headers: cookie(session) })
        expect(response.status).toBe(200)
        const catalog = await response.json() as { items: Array<{ id: string }>; owner?: unknown }
        expect(catalog).not.toHaveProperty('owner')
        expect(JSON.stringify(catalog)).not.toContain('local-owner')
        return catalog
      }))
      expect(catalogs[0].items).toEqual(catalogs[1].items)
      expect(catalogs[0].items).toHaveLength(1)
      const previewUrl = `http://127.0.0.1:3001/api/catalog/assets/${state.template.asset.id}/preview`
      expect((await state.app.request(previewUrl)).status).toBe(401)
      expect((await state.app.request(previewUrl, { headers: cookie(state.authenticated.forced) })).status).toBe(403)
      for (const session of [state.authenticated.memberA, state.authenticated.memberB]) {
        const png = await state.app.request(previewUrl, { headers: cookie(session) })
        expect(png.status).toBe(200)
        expect(png.headers.get('content-type')).toBe('image/png')
      }

      const rejectedOwner = await state.app.request('http://127.0.0.1:3001/api/presentations', {
        method: 'POST', headers: writeHeaders(state.authenticated.memberA), body: JSON.stringify({ name: 'Rejected', ownerUserId: state.users.memberB.id }),
      })
      expect(rejectedOwner.status).toBe(400)
      expect(await rejectedOwner.json()).toEqual({ error: 'Owner identity is derived from the authenticated session' })

      const createdResponse = await state.app.request('http://127.0.0.1:3001/api/presentations', {
        method: 'POST', headers: writeHeaders(state.authenticated.memberA), body: JSON.stringify({ name: 'Member A Brief' }),
      })
      expect(createdResponse.status).toBe(201)
      let presentation = (await createdResponse.json() as { presentation: ReturnType<PresentationRepository['read']> }).presentation
      expect((state.database.prepare('SELECT owner_user_id FROM presentations WHERE id = ?').get(presentation.id) as { owner_user_id: string }).owner_user_id).toBe(state.users.memberA.id)

      expect((await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}`, { headers: cookie(state.authenticated.memberB) })).status).toBe(404)
      expect((await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}`, { headers: cookie(state.authenticated.admin) })).status).toBe(404)
      const memberBList = await state.app.request('http://127.0.0.1:3001/api/presentations', { headers: cookie(state.authenticated.memberB) })
      expect((await memberBList.json() as { presentations: unknown[] }).presentations).toEqual([])
      const memberBCreate = await state.app.request('http://127.0.0.1:3001/api/presentations', {
        method: 'POST', headers: writeHeaders(state.authenticated.memberB), body: JSON.stringify({ name: 'Member B Private' }),
      })
      expect(memberBCreate.status).toBe(201)
      const memberBPresentation = (await memberBCreate.json() as { presentation: ReturnType<PresentationRepository['read']> }).presentation
      expect((state.database.prepare('SELECT owner_user_id FROM presentations WHERE id = ?').get(memberBPresentation.id) as { owner_user_id: string }).owner_user_id).toBe(state.users.memberB.id)
      expect((await state.app.request(`http://127.0.0.1:3001/api/presentations/${memberBPresentation.id}`, { headers: cookie(state.authenticated.memberA) })).status).toBe(404)
      const memberAList = await state.app.request('http://127.0.0.1:3001/api/presentations', { headers: cookie(state.authenticated.memberA) })
      expect((await memberAList.json() as { presentations: Array<{ id: string }> }).presentations.map(({ id }) => id)).toEqual([presentation.id])
      const ownedMemberBList = await state.app.request('http://127.0.0.1:3001/api/presentations', { headers: cookie(state.authenticated.memberB) })
      expect((await ownedMemberBList.json() as { presentations: Array<{ id: string }> }).presentations.map(({ id }) => id)).toEqual([memberBPresentation.id])
      const adminList = await state.app.request('http://127.0.0.1:3001/api/presentations', { headers: cookie(state.authenticated.admin) })
      expect((await adminList.json() as { presentations: unknown[] }).presentations).toEqual([])

      let response = await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items`, {
        method: 'POST', headers: writeHeaders(state.authenticated.memberA), body: JSON.stringify({ templateVersionId: state.template.version.id, expectedRevision: presentation.revision }),
      })
      presentation = (await response.json() as { presentation: typeof presentation }).presentation
      response = await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items/${presentation.items[0].id}/copy`, {
        method: 'POST', headers: writeHeaders(state.authenticated.memberA), body: JSON.stringify({ expectedRevision: presentation.revision, position: 0 }),
      })
      presentation = (await response.json() as { presentation: typeof presentation }).presentation
      const crossItemId = presentation.items[0].id
      for (const request of [
        state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items`, { method: 'POST', headers: writeHeaders(state.authenticated.memberB), body: JSON.stringify({ templateVersionId: state.template.version.id, expectedRevision: presentation.revision }) }),
        state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items/${crossItemId}/copy`, { method: 'POST', headers: writeHeaders(state.authenticated.memberB), body: JSON.stringify({ expectedRevision: presentation.revision }) }),
        state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items/${crossItemId}`, { method: 'PATCH', headers: writeHeaders(state.authenticated.memberB), body: JSON.stringify({ expectedRevision: presentation.revision, position: 0 }) }),
        state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items/${crossItemId}`, { method: 'PATCH', headers: writeHeaders(state.authenticated.memberB), body: JSON.stringify({ expectedRevision: presentation.revision, slotOverrides: {} }) }),
        state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items/${crossItemId}`, { method: 'DELETE', headers: writeHeaders(state.authenticated.memberB), body: JSON.stringify({ expectedRevision: presentation.revision }) }),
      ]) expect((await request).status).toBe(404)
      const orderBefore = presentation.items.map((item) => item.id)
      response = await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items/${presentation.items[1].id}`, {
        method: 'PATCH', headers: writeHeaders(state.authenticated.memberA), body: JSON.stringify({ expectedRevision: presentation.revision, position: 0 }),
      })
      presentation = (await response.json() as { presentation: typeof presentation }).presentation
      expect(presentation.items.map((item) => item.id)).toEqual(orderBefore.reverse())
      response = await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items/${presentation.items[0].id}`, {
        method: 'PATCH', headers: writeHeaders(state.authenticated.memberA), body: JSON.stringify({ expectedRevision: presentation.revision, slotOverrides: { title: 'Owned export', 'accent-color': '#123abc' } }),
      })
      presentation = (await response.json() as { presentation: typeof presentation }).presentation
      response = await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/items/${presentation.items[1].id}`, {
        method: 'DELETE', headers: writeHeaders(state.authenticated.memberA), body: JSON.stringify({ expectedRevision: presentation.revision }),
      })
      presentation = (await response.json() as { presentation: typeof presentation }).presentation
      response = await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}`, {
        method: 'PATCH', headers: writeHeaders(state.authenticated.memberA), body: JSON.stringify({ name: 'Member A Final', expectedRevision: presentation.revision }),
      })
      presentation = (await response.json() as { presentation: typeof presentation }).presentation
      expect(presentation).toMatchObject({ name: 'Member A Final', items: [{ position: 0 }] })

      const crossWrite = await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}`, {
        method: 'PATCH', headers: writeHeaders(state.authenticated.memberB), body: JSON.stringify({ name: 'Hijack', expectedRevision: presentation.revision }),
      })
      expect(crossWrite.status).toBe(404)

      const exportResponse = await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/exports`, {
        method: 'POST', headers: writeHeaders(state.authenticated.memberA), body: JSON.stringify({ expectedRevision: presentation.revision, itemIds: presentation.items.map((item) => item.id) }),
      })
      expect(exportResponse.status).toBe(201)
      const exported = await exportResponse.json() as { export: { id: string }; manifest: { contractVersion: string; ownerUserId: string } }
      expect(exported.manifest).toMatchObject({ contractVersion: 'html-presentation-export/v3', ownerUserId: state.users.memberA.id })
      const zip = state.exports.readArtifact(getOwnerContext(state.users.memberA.id), presentation.id, exported.export.id, 'zip')
      const embedded = JSON.parse(readStoredZip(zip).get('manifest.json')!.toString('utf8')) as { contractVersion: string; ownerUserId: string }
      expect(embedded).toMatchObject({ contractVersion: 'html-presentation-export-package/v3', ownerUserId: state.users.memberA.id })

      expect((await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/exports`)).status).toBe(401)
      const crossExport = await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/exports`, {
        method: 'POST', headers: writeHeaders(state.authenticated.memberB), body: JSON.stringify({ expectedRevision: presentation.revision, itemIds: presentation.items.map((item) => item.id) }),
      })
      expect(crossExport.status).toBe(404)
      for (const session of [state.authenticated.memberB, state.authenticated.admin]) {
        expect((await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/exports`, { headers: cookie(session) })).status).toBe(404)
        expect((await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/exports/${exported.export.id}/manifest`, { headers: cookie(session) })).status).toBe(404)
        expect((await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/exports/${exported.export.id}/html`, { headers: cookie(session) })).status).toBe(404)
        expect((await state.app.request(`http://127.0.0.1:3001/api/presentations/${presentation.id}/exports/${exported.export.id}/zip`, { headers: cookie(session) })).status).toBe(404)
      }
    } finally {
      state.database.close()
    }
  })

  it('limits global recovery to password-ready admins, revalidates v2 ownership, revokes every session, and excludes secrets from manifests and diagnostics', async () => {
    const state = await businessFixture()
    try {
      const owner = getOwnerContext(state.users.memberA.id)
      const created = state.presentations.create(owner, 'Recovery owner')
      const added = state.presentations.add(owner, created.id, state.template.version.id, created.revision)
      state.exports.create(owner, added.id, added.revision, added.items.map((item) => item.id))

      expect((await state.app.request('http://127.0.0.1:3001/api/recovery')).status).toBe(401)
      expect((await state.app.request('http://127.0.0.1:3001/api/recovery', { headers: cookie(state.authenticated.memberA) })).status).toBe(403)
      expect((await state.app.request('http://127.0.0.1:3001/api/recovery', { headers: cookie(state.authenticated.forced) })).status).toBe(403)

      const overviewResponse = await state.app.request('http://127.0.0.1:3001/api/recovery', { headers: cookie(state.authenticated.admin) })
      expect(overviewResponse.status).toBe(200)
      const overview = (await overviewResponse.json() as { recovery: { stateSha256: string; owner?: unknown } }).recovery
      expect(overview).not.toHaveProperty('owner')
      expect(JSON.stringify(overview)).not.toContain('local-owner')
      const backupResponse = await state.app.request('http://127.0.0.1:3001/api/recovery/backups', {
        method: 'POST', headers: writeHeaders(state.authenticated.admin), body: JSON.stringify({ expectedStateSha256: overview.stateSha256 }),
      })
      expect(backupResponse.status).toBe(201)
      const backup = (await backupResponse.json() as { backup: { id: string; manifestSha256: string } }).backup
      const manifestResponse = await state.app.request(`http://127.0.0.1:3001/api/recovery/backups/${backup.id}/manifest`, { headers: cookie(state.authenticated.admin) })
      const manifestPayload = await manifestResponse.json() as { manifest: { database: { migrationLedger: unknown[] }; presentations: Array<{ ownerUserId: string }>; exports: Array<{ ownerUserId: string }> } }
      expect(manifestPayload.manifest.database.migrationLedger).toHaveLength(8)
      expect(manifestPayload.manifest.presentations).toEqual([expect.objectContaining({ ownerUserId: state.users.memberA.id })])
      expect(manifestPayload.manifest.exports).toEqual([expect.objectContaining({ ownerUserId: state.users.memberA.id })])
      expect(JSON.stringify(manifestPayload)).not.toMatch(/password|token|secret|credential|api[_-]?key/i)
      expect(scalar(state.database, 'SELECT count(*) AS count FROM sessions')).toBe(4)

      const restoreResponse = await state.app.request(`http://127.0.0.1:3001/api/recovery/backups/${backup.id}/restore`, {
        method: 'POST', headers: writeHeaders(state.authenticated.admin), body: JSON.stringify({ expectedManifestSha256: backup.manifestSha256 }),
      })
      expect(restoreResponse.status).toBe(201)
      const restore = (await restoreResponse.json() as { restore: { id: string } }).restore
      expect(scalar(state.database, 'SELECT count(*) AS count FROM sessions')).toBe(0)
      expect((await state.app.request('http://127.0.0.1:3001/api/recovery', { headers: cookie(state.authenticated.admin) })).status).toBe(401)
      const restored = new Database(join(state.restoreRoot, restore.id, 'database/asset-library.db'), { readonly: true, fileMustExist: true })
      try { expect(scalar(restored, 'SELECT count(*) AS count FROM sessions')).toBe(0) } finally { restored.close() }

      const diagnostics = state.database.prepare('SELECT diagnostic FROM audit_events ORDER BY rowid').all() as { diagnostic: string }[]
      expect(JSON.stringify(diagnostics)).not.toMatch(/ownership-test-password|__Host-ppt_session|token|secret|credential|api[_-]?key/i)
    } finally {
      state.database.close()
    }
  })
})

describe('P14 empty-only ownership migration', () => {
  it('adds the non-null foreign key, index, immutable triggers and current recovery ledger on an empty target', () => {
    const path = join(temporaryRoot('empty-migration'), 'asset-library.db')
    migrateDatabase(path)
    const database = openDatabase(path)
    try {
      expect(database.pragma('quick_check', { simple: true })).toBe('ok')
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(scalar(database, 'SELECT count(*) AS count FROM __drizzle_migrations')).toBe(8)
      expect((database.prepare('SELECT name FROM sqlite_master WHERE type = \'trigger\' ORDER BY name').all() as { name: string }[]).map((row) => row.name)).toEqual([...TARGET_DATABASE_TRIGGERS].sort())
      expect((database.prepare('PRAGMA table_info(presentations)').all() as { name: string; notnull: number }[])).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'owner_user_id', notnull: 1 })]))
      expect(database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'presentations_owner_updated_idx'").get()).toEqual({ count: 1 })
      expect((database.prepare('PRAGMA foreign_key_list(presentations)').all() as { table: string; from: string }[])).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'users', from: 'owner_user_id' })]))

      const first = new UserRepository(database as never).create({ username: 'first', passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', status: 'active' })
      const second = new UserRepository(database as never).create({ username: 'second', passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', status: 'active' })
      const presentation = new PresentationRepository(database as never).create(getOwnerContext(first.id), 'Owned')
      expect(() => database.prepare('UPDATE presentations SET owner_user_id = ? WHERE id = ?').run(second.id, presentation.id)).toThrow(/immutable/)
      expect(() => database.prepare('INSERT INTO presentations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('presentation-no-owner', 'Missing', 1, 1)).toThrow(/owner|NOT NULL/i)
      expect(() => database.prepare('INSERT INTO presentations (id, owner_user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('presentation-bad-owner', 'user-00000000-0000-4000-8000-000000000099', 'Bad', 1, 1)).toThrow(/FOREIGN KEY/i)
    } finally { database.close() }
  })

  it('backs up and refuses every populated pre-P14 ownership shape without assigning it automatically', () => {
    for (const kind of ['presentations', 'presentation_items', 'presentation_exports'] as const) {
      const path = join(temporaryRoot(`blocked-${kind}`), 'asset-library.db')
      createSixMigrationDatabase(path)
      const database = openDatabase(path)
      const now = Date.now()
      if (kind === 'presentations') {
        database.prepare('INSERT INTO presentations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('presentation-blocked', 'Blocked', now, now)
      } else if (kind === 'presentation_items') {
        database.pragma('foreign_keys = OFF')
        database.prepare('INSERT INTO presentation_items (id, presentation_id, template_version_id, position, slot_overrides, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run('item-blocked', 'presentation-missing', 'version-missing', '{}', now, now)
      } else {
        database.pragma('foreign_keys = OFF')
        database.prepare('INSERT INTO presentations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('presentation-temporary', 'Temporary', now, now)
        for (const [digest, mediaType] of [["a".repeat(64), 'application/vnd.html-presentation-export-manifest+json'], ["b".repeat(64), 'text/html; charset=utf-8'], ["c".repeat(64), 'application/zip']] as const) {
          database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, 1, ?, ?)').run(digest, mediaType, `sha256/${digest.slice(0, 2)}/${digest}`, now)
        }
        database.prepare('INSERT INTO presentation_exports (id, presentation_id, presentation_revision, manifest_digest, html_digest, zip_digest, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)').run('export-blocked', 'presentation-temporary', 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), now)
        database.prepare('DELETE FROM presentations WHERE id = ?').run('presentation-temporary')
      }
      for (const table of ['presentations', 'presentation_items', 'presentation_exports'] as const) {
        expect(scalar(database, `SELECT count(*) AS count FROM ${table}`)).toBe(table === kind ? 1 : 0)
      }
      database.close()

      expect(() => migrateDatabase(path)).toThrow(new RegExp(`${kind}=1`))
      expect(existsSync(join(dirname(path), 'backups'))).toBe(true)
      const unchanged = openDatabase(path)
      try {
        expect(scalar(unchanged, 'SELECT count(*) AS count FROM __drizzle_migrations')).toBe(6)
        expect((unchanged.prepare('PRAGMA table_info(presentations)').all() as { name: string }[]).some((column) => column.name === 'owner_user_id')).toBe(false)
      } finally { unchanged.close() }
    }
  })

  it('backs up and rejects an unknown trigger before running the ownership migration', () => {
    const path = join(temporaryRoot('unknown-trigger'), 'asset-library.db')
    createSixMigrationDatabase(path)
    const database = openDatabase(path)
    database.exec("CREATE TRIGGER unexpected_owner_trigger BEFORE INSERT ON presentations BEGIN SELECT RAISE(ABORT, 'blocked'); END")
    database.close()
    expect(() => migrateDatabase(path)).toThrow(/unknown database triggers: unexpected_owner_trigger/)
    expect(readdirSync(join(dirname(path), 'backups'))).toHaveLength(1)
  })
})
