import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { AssetLibraryCatalog, parseCatalogQuery } from '../apps/api/src/assets/library-catalog.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { PresentationExportRepository } from '../apps/api/src/presentation-exports/presentation-export-repository.js'
import { readStoredZip, sha256 } from '../apps/api/src/presentation-exports/offline-archive.js'
import { PresentationRepository } from '../apps/api/src/presentations/presentation-repository.js'
import { LocalRecoveryService, type LocalBackupManifest } from '../apps/api/src/recovery/local-recovery.js'
import { adaptSimulatedTemplatePackage } from '../apps/api/src/templates/simulated-adapter.js'
import { getOwnerContext } from '../apps/api/src/owner.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): { all(...parameters: unknown[]): unknown[]; get(...parameters: unknown[]): unknown; run(...parameters: unknown[]): { changes: number } }
  close(): void
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string, options?: { readonly?: boolean; fileMustExist?: boolean }) => SQLite

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

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'asset-library-p09-'))
  const databasePath = join(directory, 'source/asset-library.db')
  const contentRoot = join(directory, 'source/objects')
  const backupRoot = join(directory, 'backups')
  const restoreRoot = join(directory, 'restores')
  migrateDatabase(databasePath)
  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  const store = new LocalContentStore(contentRoot)
  const template = adaptSimulatedTemplatePackage(join(process.cwd(), 'fixtures/p03-simulated-template'))
  const registered = new AssetCatalogRepository(database as never, store).registerTemplate(template)
  const now = Date.now()
  const derivatives = [
    { kind: 'preview', object: store.put(fakePng(1280, 720, 1), 'image/png') },
    { kind: 'thumbnail', object: store.put(fakePng(320, 180, 2), 'image/png') },
  ] as const
  for (const derivative of derivatives) {
    database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(derivative.object.digest, derivative.object.mediaType, derivative.object.byteSize, derivative.object.relativePath, now)
    database.prepare('INSERT INTO template_preview_derivatives (template_version_id, kind, source_digest, content_digest, renderer_version, security_diagnostic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(template.version.id, derivative.kind, registered.sourceDigest, derivative.object.digest, 'p09-fixture-renderer', secureDiagnostic, now)
  }
  const presentations = new PresentationRepository(database as never)
  const exports = new PresentationExportRepository(database as never, store)
  const owner = getOwnerContext()
  const created = presentations.create(owner, 'P09 Recovery Fixture')
  const added = presentations.add(owner, created.id, template.version.id, created.revision)
  const presentation = presentations.reviseOverrides(owner, added.id, added.items[0].id, { title: 'Recovered & fixed', 'accent-color': '#123abc' }, added.revision)
  const exported = exports.create(owner, presentation.id, presentation.revision, presentation.items.map((item) => item.id))
  database.close()
  const service = new LocalRecoveryService({ databasePath, contentRoot, backupRoot, restoreRoot })
  return { directory, databasePath, contentRoot, backupRoot, restoreRoot, service, template, presentation, exported }
}

function sourceFingerprint(state: ReturnType<typeof fixture>): string {
  const pieces = [hashFile(state.databasePath)]
  const walk = (directory: string): void => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else pieces.push(`${path.slice(state.directory.length)}:${hashFile(path)}`)
    }
  }
  walk(state.contentRoot)
  return sha256(Buffer.from(pieces.join('\n')))
}

async function backedUpFixture() {
  const state = fixture()
  const overview = state.service.inspectCurrent()
  const backup = await state.service.createBackup(overview.stateSha256)
  const readback = state.service.readBackupManifest(backup.id)
  return { ...state, overview, backup, readback }
}

describe('P09 auditable local backup manifest', () => {
  it('backs up the exact migration ledger, P04 CAS, P05 derivatives, fixed Presentation and P08 objects without changing the source', async () => {
    const state = fixture()
    try {
      const before = sourceFingerprint(state)
      const overview = state.service.inspectCurrent()
      const backup = await state.service.createBackup(overview.stateSha256)
      const { manifest, manifestSha256 } = state.service.readBackupManifest(backup.id)
      expect(manifestSha256).toBe(backup.manifestSha256)
      expect(manifest).toMatchObject({
        contractVersion: 'asset-library-local-backup/v1',
        backupId: backup.id,
        source: { stateSha256: overview.stateSha256, databaseSha256Before: overview.databaseSha256, databaseSha256After: overview.databaseSha256 },
        database: { relativePath: 'database/asset-library.db', quickCheck: 'ok', foreignKeys: true, foreignKeyCheckCount: 0 },
        derivatives: [
          { templateVersionId: state.template.version.id, kind: 'preview', rendererVersion: 'p09-fixture-renderer' },
          { templateVersionId: state.template.version.id, kind: 'thumbnail', rendererVersion: 'p09-fixture-renderer' },
        ],
        presentations: [{ id: state.presentation.id, revision: state.presentation.revision, itemCount: 1, items: [{ templateVersionId: state.template.version.id }] }],
        exports: [{ id: state.exported.summary.id, presentationRevision: state.presentation.revision }],
      })
      expect(manifest.database.migrationLedger.map((entry) => entry.tag)).toEqual([
        '0000_p02_foundation', '0001_p04_catalog_jobs', '0002_p05_preview_derivatives', '0003_p07_presentation_items', '0004_p08_presentation_exports',
        '0005_p12_auth_core',
      ])
      expect(manifest.database.migrationLedger.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true)
      expect(new Set(manifest.objects.flatMap((object) => object.roles))).toEqual(expect.objectContaining(new Set(['template-package', 'preview', 'thumbnail', 'export-manifest', 'export-html', 'export-zip'])))
      expect(manifest.objects.every((object) => object.relativePath === `objects/sha256/${object.digest.slice(0, 2)}/${object.digest}`)).toBe(true)
      expect(sourceFingerprint(state)).toBe(before)
    } finally { rmSync(state.directory, { recursive: true, force: true }) }
  })
})

describe('P09 isolated restore and fixture-only replay', () => {
  it('restores into a new directory, rechecks SQLite/CAS/P05/P08, and replays P06/P07/P08 without touching the source', async () => {
    const state = await backedUpFixture()
    try {
      const sourceBefore = sourceFingerprint(state)
      const restore = state.service.restoreBackup(state.backup.id, state.backup.manifestSha256)
      const restoreDirectory = join(state.restoreRoot, restore.id)
      const restoredDatabasePath = join(restoreDirectory, 'database/asset-library.db')
      const restoredContentRoot = join(restoreDirectory, 'objects')
      expect(existsSync(restoredDatabasePath)).toBe(true)
      expect(readFileSync(join(restoreDirectory, 'restore-report.json'), 'utf8')).toContain('asset-library-local-restore/v1')

      const beforeMigration = hashFile(restoredDatabasePath)
      expect(migrateDatabase(restoredDatabasePath)).toMatchObject({ existed: true })
      expect(hashFile(restoredDatabasePath)).toBe(beforeMigration)

      const database = new Database(restoredDatabasePath)
      database.pragma('foreign_keys = ON')
      try {
        expect(database.pragma('quick_check', { simple: true })).toBe('ok')
        expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
        expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
        expect(database.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: 6 })
        const store = new LocalContentStore(restoredContentRoot)
        const owner = getOwnerContext()
        const catalog = new AssetLibraryCatalog(database as never, store)
        const catalogResult = catalog.list(owner, parseCatalogQuery('http://127.0.0.1/api/catalog'))
        expect(catalogResult.items).toHaveLength(1)
        expect(catalog.readDerivative(owner, state.template.asset.id, 'preview').readUInt32BE(16)).toBe(1280)

        const presentations = new PresentationRepository(database as never)
        expect(presentations.read(owner, state.presentation.id)).toMatchObject({ revision: state.presentation.revision, items: [{ templateVersionId: state.template.version.id }] })
        const exports = new PresentationExportRepository(database as never, store)
        const restoredManifest = exports.readManifest(owner, state.presentation.id, state.exported.summary.id)
        expect(restoredManifest.package.zipSha256).toBe(state.exported.manifest.package.zipSha256)
        expect(readStoredZip(exports.readArtifact(owner, state.presentation.id, state.exported.summary.id, 'zip')).has('index.html')).toBe(true)

        const replayCreated = presentations.create(owner, 'P09 Restored Replay')
        const replayAdded = presentations.add(owner, replayCreated.id, state.template.version.id, replayCreated.revision)
        const replayRevised = presentations.reviseOverrides(owner, replayAdded.id, replayAdded.items[0].id, { title: 'Fixture-only replay', 'accent-color': '#2563eb' }, replayAdded.revision)
        const replayExport = exports.create(owner, replayRevised.id, replayRevised.revision, replayRevised.items.map((item) => item.id))
        const html = exports.readArtifact(owner, replayRevised.id, replayExport.summary.id, 'html').toString('utf8')
        expect(html).toContain('Fixture-only replay')
        expect(html).not.toMatch(/<(?:script|iframe|form)\b|https?:|file:|data:|blob:|document\.cookie/i)
      } finally { database.close() }
      expect(sourceFingerprint(state)).toBe(sourceBefore)
    } finally { rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('rejects repeated restore without overwriting the verified first result', async () => {
    const state = await backedUpFixture()
    try {
      const first = state.service.restoreBackup(state.backup.id, state.backup.manifestSha256)
      const databasePath = join(state.restoreRoot, first.id, 'database/asset-library.db')
      const before = hashFile(databasePath)
      expect(() => state.service.restoreBackup(state.backup.id, state.backup.manifestSha256)).toThrow(/never overwrites/)
      expect(hashFile(databasePath)).toBe(before)
    } finally { rmSync(state.directory, { recursive: true, force: true }) }
  })
})

describe('P09 recovery negative and security boundaries', () => {
  it('rejects missing or tampered database, CAS, manifest and ZIP with no half-restore', async () => {
    for (const fault of ['database', 'cas', 'manifest', 'zip'] as const) {
      const state = await backedUpFixture()
      try {
        const directory = join(state.backupRoot, state.backup.id)
        if (fault === 'database') unlinkSync(join(directory, 'database/asset-library.db'))
        if (fault === 'manifest') writeFileSync(join(directory, 'backup-manifest.json'), '{}\n')
        if (fault === 'cas') {
          const object = state.readback.manifest.objects.find((entry) => entry.roles.includes('template-package'))!
          writeFileSync(join(directory, object.relativePath), 'tampered')
        }
        if (fault === 'zip') {
          const object = state.readback.manifest.objects.find((entry) => entry.roles.includes('export-zip'))!
          writeFileSync(join(directory, object.relativePath), 'tampered zip')
        }
        expect(() => state.service.restoreBackup(state.backup.id, state.backup.manifestSha256)).toThrow(/missing|hash|tampered|manifest/i)
        expect(existsSync(join(state.restoreRoot, `restore-${state.backup.id}`))).toBe(false)
        expect(existsSync(state.restoreRoot) ? readdirSync(state.restoreRoot).filter((name) => name.startsWith('.restore-')) : []).toEqual([])
      } finally { rmSync(state.directory, { recursive: true, force: true }) }
    }
  })

  it('rejects traversal, absolute ids, symlink escape and undeclared manifest paths', async () => {
    const state = await backedUpFixture()
    try {
      expect(() => state.service.readBackupManifest('../outside')).toThrow(/invalid|escapes/)
      expect(() => state.service.readBackupManifest('/absolute')).toThrow(/invalid|escapes/)
      const outside = join(state.directory, 'outside')
      mkdirSync(outside)
      symlinkSync(outside, join(state.backupRoot, 'backup-symlink'))
      expect(() => state.service.readBackupManifest('backup-symlink')).toThrow(/non-symbolic/)

      const manifestPath = join(state.backupRoot, state.backup.id, 'backup-manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as LocalBackupManifest
      const tampered = { ...manifest, objects: manifest.objects.map((object, index) => index === 0 ? { ...object, relativePath: '../outside' } : object) }
      writeFileSync(manifestPath, `${JSON.stringify(tampered, null, 2)}\n`)
      expect(() => state.service.restoreBackup(state.backup.id, hashFile(manifestPath))).toThrow(/unsafe|path/)
      expect(existsSync(join(state.restoreRoot, `restore-${state.backup.id}`))).toBe(false)
    } finally { rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('cleans interrupted backup/restore work and reports bounded non-secret permission failures', async () => {
    const state = fixture()
    try {
      const overview = state.service.inspectCurrent()
      const interruptedBackupRoot = join(state.directory, 'interrupted-backups')
      const interrupted = new LocalRecoveryService({
        databasePath: state.databasePath,
        contentRoot: state.contentRoot,
        backupRoot: interruptedBackupRoot,
        restoreRoot: join(state.directory, 'interrupted-restores'),
        faults: { afterDatabaseSnapshot: () => { throw new Error(`password=do-not-leak ${'x'.repeat(500)}`) } },
      })
      let diagnostic = ''
      try { await interrupted.createBackup(overview.stateSha256) } catch (error) { diagnostic = (error as Error).message }
      expect(diagnostic.length).toBeLessThanOrEqual(300)
      expect(diagnostic).not.toContain('do-not-leak')
      expect(readdirSync(interruptedBackupRoot)).toEqual([])

      const backup = await state.service.createBackup(overview.stateSha256)
      const interruptedRestore = new LocalRecoveryService({
        databasePath: state.databasePath,
        contentRoot: state.contentRoot,
        backupRoot: state.backupRoot,
        restoreRoot: join(state.directory, 'interrupted-restores'),
        faults: { afterRestoreObject: () => { throw new Error('simulated interruption') } },
      })
      expect(() => interruptedRestore.restoreBackup(backup.id, backup.manifestSha256)).toThrow(/Isolated restore failed/)
      expect(readdirSync(join(state.directory, 'interrupted-restores'))).toEqual([])

      const readOnlyRoot = join(state.directory, 'read-only-backups')
      mkdirSync(readOnlyRoot, { mode: 0o500 })
      try {
        const readOnly = new LocalRecoveryService({ databasePath: state.databasePath, contentRoot: state.contentRoot, backupRoot: readOnlyRoot, restoreRoot: state.restoreRoot })
        await expect(readOnly.createBackup(overview.stateSha256)).rejects.toThrow(/failed|writable/i)
      } finally { chmodSync(readOnlyRoot, 0o700) }
    } finally { rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('uses stale-state and manifest CAS at the loopback API while old capabilities remain 404', async () => {
    const state = fixture()
    try {
      const overview = state.service.inspectCurrent()
      const app = createApp({ recovery: state.service })
      const root = 'http://127.0.0.1:3001/api/recovery'
      const origin = { origin: 'http://127.0.0.1:5173' }
      expect((await app.request(root)).status).toBe(200)
      expect((await app.request(`${root}?path=../outside`)).status).toBe(400)
      expect((await app.request('http://example.test/api/recovery')).status).toBe(421)
      expect((await app.request(root, { headers: { origin: 'https://example.test' } })).status).toBe(403)

      const stale = await app.request(`${root}/backups`, { method: 'POST', headers: origin, body: JSON.stringify({ expectedStateSha256: '0'.repeat(64) }) })
      expect(stale.status).toBe(409)
      expect(await stale.json()).toEqual({ error: 'Recovery source state is stale; reload and retry' })
      const extra = await app.request(`${root}/backups`, { method: 'POST', headers: origin, body: JSON.stringify({ expectedStateSha256: overview.stateSha256, path: '../outside' }) })
      expect(extra.status).toBe(400)

      const created = await app.request(`${root}/backups`, { method: 'POST', headers: origin, body: JSON.stringify({ expectedStateSha256: overview.stateSha256 }) })
      expect(created.status).toBe(201)
      const backup = (await created.json() as { backup: { id: string; manifestSha256: string } }).backup
      expect((await app.request(`${root}/backups/${backup.id}/manifest`)).status).toBe(200)
      expect((await app.request(`${root}/backups/${backup.id}/restore`, { method: 'POST', headers: origin, body: JSON.stringify({ expectedManifestSha256: '0'.repeat(64) }) })).status).toBe(409)
      expect((await app.request(`${root}/backups/${backup.id}/restore`, { method: 'POST', headers: origin, body: JSON.stringify({ expectedManifestSha256: backup.manifestSha256 }) })).status).toBe(201)
      expect((await app.request(`${root}/backups/${backup.id}/restore`, { method: 'POST', headers: origin, body: JSON.stringify({ expectedManifestSha256: backup.manifestSha256 }) })).status).toBe(409)
      for (const path of ['/api/auth/login', '/api/admin/users', '/api/preview', '/api/export', '/api/search']) expect((await app.request(`http://127.0.0.1:3001${path}`)).status).toBe(404)
    } finally { rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('keeps the P09 Web surface on controlled JSON and PNG without executable template injection', () => {
    const source = [
      'apps/web/src/routes/(app)/+page.svelte',
      'apps/web/src/lib/recovery.ts',
      'apps/web/src/routes/api/recovery/[...path]/+server.ts',
    ].map((path) => readFileSync(join(process.cwd(), path), 'utf8')).join('\n')
    expect(source).not.toMatch(/<iframe|srcdoc|\{@html|innerHTML|createObjectURL|file:\/\//i)
    expect(source).not.toMatch(/https?:\/\//i)
  })
})
