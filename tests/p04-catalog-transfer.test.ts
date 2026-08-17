import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { CatalogTransferError, CatalogTransferService, type CatalogTransferValidation } from '../apps/api/src/assets/catalog-transfer.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { AssetLibraryCatalog, parseCatalogQuery } from '../apps/api/src/assets/library-catalog.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { adaptSimulatedTemplatePackage, adaptTemplatePackageSource } from '../apps/api/src/templates/simulated-adapter.js'
import { createTrustedTestAuth, seedTestUser, TEST_USER_ID } from './p14-test-support.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): {
    all(...parameters: unknown[]): unknown[]
    get(...parameters: unknown[]): unknown
    run(...parameters: unknown[]): { changes: number }
  }
  close(): void
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite
const JSZip = createRequire(new URL('../apps/api/package.json', import.meta.url))('jszip') as typeof import('jszip')
const fixture = join(process.cwd(), 'fixtures/p03-simulated-template')
const releaseSha = 'a'.repeat(40)
const derivativeDeleteTrigger = 'template_preview_derivatives_append_only_delete'

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

function openState(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const databasePath = join(root, 'asset-library.db')
  migrateDatabase(databasePath)
  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  const store = new LocalContentStore(join(root, 'objects'))
  const service = new CatalogTransferService({
    database: database as never,
    contentStore: store,
    stagingRoot: join(root, 'catalog-transfer-staging'),
    sourceReleaseSha: releaseSha,
  })
  return { root, database, store, service }
}

function registerFixture(state: ReturnType<typeof openState>, rendererVersion = 'p04-transfer-fixture:1', assetSuffix = '') {
  const base = adaptSimulatedTemplatePackage(fixture)
  const template = assetSuffix
    ? adaptTemplatePackageSource({
      ...base.source,
      manifest: {
        ...base.source.manifest,
        id: `${base.source.manifest.id}-${assetSuffix}`,
        title: `${base.source.manifest.title} ${assetSuffix}`,
      },
    })
    : base
  const registered = new AssetCatalogRepository(state.database as never, state.store).registerTemplate(template)
  const preview = state.store.put(png(1280, 720, 1), 'image/png')
  const thumbnail = state.store.put(png(320, 180, 2), 'image/png')
  const now = 1_786_636_800_000
  for (const object of [preview, thumbnail]) {
    state.database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(object.digest, object.mediaType, object.byteSize, object.relativePath, now)
  }
  for (const [kind, object] of [['preview', preview], ['thumbnail', thumbnail]] as const) {
    state.database.prepare(
      'INSERT INTO template_preview_derivatives (template_version_id, kind, source_digest, content_digest, renderer_version, security_diagnostic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .run(registered.versionId, kind, registered.sourceDigest, object.digest, rendererVersion, '{"networkAccessBlocked":true}', now)
  }
  return registered
}

function addRendererPair(
  state: ReturnType<typeof openState>,
  registered: ReturnType<typeof registerFixture>,
  rendererVersion: string,
  createdAt: number,
): void {
  const preview = state.store.put(png(1280, 720, 3), 'image/png')
  const thumbnail = state.store.put(png(320, 180, 4), 'image/png')
  for (const object of [preview, thumbnail]) {
    state.database.prepare(
      'INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(object.digest, object.mediaType, object.byteSize, object.relativePath, createdAt)
  }
  for (const [kind, object] of [['preview', preview], ['thumbnail', thumbnail]] as const) {
    state.database.prepare(
      'INSERT INTO template_preview_derivatives (template_version_id, kind, source_digest, content_digest, renderer_version, security_diagnostic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      registered.versionId,
      kind,
      registered.sourceDigest,
      object.digest,
      rendererVersion,
      '{"networkAccessBlocked":true}',
      createdAt,
    )
  }
}

function derivativeDeleteGuardSql(database: SQLite): string {
  const row = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(
    derivativeDeleteTrigger,
  ) as { sql?: unknown } | undefined
  if (typeof row?.sql !== 'string' || row.sql.length === 0) throw new Error('derivative delete guard SQL is unavailable')
  return row.sql
}

function installCustomDerivativeDeleteGuard(database: SQLite): string {
  database.prepare(`DROP TRIGGER ${derivativeDeleteTrigger}`).run()
  database.prepare(`
    CREATE TRIGGER "${derivativeDeleteTrigger}"
      BEFORE DELETE
      ON template_preview_derivatives
      FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'preview derivatives are append-only');
    END
  `).run()
  return derivativeDeleteGuardSql(database)
}

function catalogCounts(database: SQLite) {
  return Object.fromEntries(
    ['content_objects', 'template_assets', 'template_versions', 'tags', 'template_asset_tags', 'template_preview_derivatives'].map((
      table,
    ) => [
      table,
      (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count,
    ]),
  )
}

function catalogFingerprint(database: SQLite): string {
  const tables = ['content_objects', 'template_assets', 'template_versions', 'tags', 'template_asset_tags', 'template_preview_derivatives']
  const snapshot = Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]))
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function directoryFingerprint(path: string): string {
  const files: Array<{ path: string; sha256: string }> = []
  const visit = (directory: string, prefix = ''): void => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) visit(absolutePath, relativePath)
      else files.push({ path: relativePath, sha256: createHash('sha256').update(readFileSync(absolutePath)).digest('hex') })
    }
  }
  visit(path)
  return createHash('sha256').update(JSON.stringify(files)).digest('hex')
}

function protectedFingerprint(database: SQLite): string {
  const tables = ['users', 'sessions', 'auth_throttle', 'presentations', 'presentation_items', 'presentation_exports']
  const snapshot = Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]))
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

async function rewriteManifest(archive: Uint8Array, change: (manifest: Record<string, unknown>) => void): Promise<Buffer> {
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true })
  const entry = zip.file('catalog-transfer-manifest.json')
  if (!entry) throw new Error('manifest missing')
  const manifest = JSON.parse(await entry.async('string')) as Record<string, unknown>
  change(manifest)
  zip.file('catalog-transfer-manifest.json', `${JSON.stringify(manifest)}\n`, { date: new Date('1980-01-01T00:00:00.000Z') })
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
}

async function expectRejectedWithoutCatalogWrites(
  target: ReturnType<typeof openState>,
  archive: Uint8Array,
  pattern: RegExp,
): Promise<void> {
  const before = catalogCounts(target.database)
  await expect(target.service.validateArchive(archive)).rejects.toThrow(pattern)
  expect(catalogCounts(target.database)).toEqual(before)
}

describe('P04 asset-library-catalog-transfer/v1', () => {
  it('exports, validates and applies a sealed active catalog while preserving non-empty protected tables', async () => {
    const source = openState('p04-transfer-source-')
    const target = openState('p04-transfer-target-')
    try {
      const sourceTemplate = registerFixture(source)
      const admin = seedTestUser(target.database as never)
      target.database.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('session-transfer-fixture', admin.id, 'b'.repeat(64), admin.createdAt + 604_800_000, admin.createdAt)
      target.database.prepare('INSERT INTO auth_throttle (key_hash, window_started_at, count, blocked_until) VALUES (?, ?, ?, NULL)')
        .run('c'.repeat(64), admin.createdAt, 1)
      target.database.prepare(
        'INSERT INTO presentations (id, name, status, revision, created_at, updated_at, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .run('presentation-history', '历史汇报', 'draft', 0, admin.createdAt, admin.createdAt, TEST_USER_ID)

      const extra = registerFixture(target, 'p04-target-extra:1', 'extra')
      target.database.prepare(
        'INSERT INTO presentation_items (id, presentation_id, template_version_id, position, slot_overrides, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
      )
        .run('item-history', 'presentation-history', extra.versionId, '{}', admin.createdAt, admin.createdAt)
      const exportObjects = [
        target.store.put(Buffer.from('{"export":true}'), 'application/vnd.html-presentation-export-manifest+json'),
        target.store.put(Buffer.from('<!doctype html>'), 'text/html; charset=utf-8'),
        target.store.put(Buffer.from('PK\u0005\u0006'.padEnd(22, '\u0000')), 'application/zip'),
      ]
      for (const object of exportObjects) {
        target.database.prepare(
          'INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)',
        )
          .run(object.digest, object.mediaType, object.byteSize, object.relativePath, admin.createdAt)
      }
      target.database.prepare(
        'INSERT INTO presentation_exports (id, presentation_id, presentation_revision, manifest_digest, html_digest, zip_digest, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
      )
        .run(
          'export-history',
          'presentation-history',
          exportObjects[0].digest,
          exportObjects[1].digest,
          exportObjects[2].digest,
          admin.createdAt,
        )
      const protectedBefore = protectedFingerprint(target.database)

      const archive = await source.service.exportArchive()
      expect(await source.service.exportArchive()).toEqual(archive)
      const exportedZip = await JSZip.loadAsync(archive)
      const exportedManifest = JSON.parse(await exportedZip.file('catalog-transfer-manifest.json')!.async('string')) as Record<
        string,
        unknown
      >
      expect(Object.keys(exportedManifest).sort()).toEqual([
        'assets',
        'contractVersion',
        'counts',
        'derivatives',
        'files',
        'objects',
        'sourceCatalogStateSha256',
        'sourceReleaseSha',
        'tags',
        'versions',
      ])
      expect(
        Object.keys(exportedZip.files).every((name) =>
          name === 'catalog-transfer-manifest.json' || /^objects\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(name)
        ),
      ).toBe(true)
      for (
        const forbidden of [
          'users',
          'passwords',
          'sessions',
          'presentations',
          'presentationItems',
          'exports',
          'recoveryBackups',
          'secrets',
          'keys',
        ]
      ) expect(exportedManifest).not.toHaveProperty(forbidden)
      const validated = await target.service.validateArchive(archive)
      expect(validated).toMatchObject({
        transferId: `transfer-${validated.manifestSha256}`,
        sourceCatalogStateSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        targetCatalogStateSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        diff: { activate: [sourceTemplate.assetId], retire: [extra.assetId] },
      })
      expect(protectedFingerprint(target.database)).toBe(protectedBefore)

      const applied = await target.service.apply(validated.transferId, {
        expectedManifestSha256: validated.manifestSha256,
        expectedTargetCatalogStateSha256: validated.targetCatalogStateSha256,
      })
      expect(applied).toMatchObject({
        applied: true,
        protectedState: {
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          tables: {
            users: { count: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
            sessions: { count: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
            auth_throttle: { count: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
            presentations: { count: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
            presentation_items: { count: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
            presentation_exports: { count: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
          },
        },
      })
      expect(protectedFingerprint(target.database)).toBe(protectedBefore)
      expect(target.database.prepare('SELECT status FROM template_assets WHERE id = ?').get(extra.assetId)).toEqual({ status: 'retired' })
      expect(target.database.prepare('SELECT template_version_id FROM presentation_items WHERE id = ?').get('item-history')).toEqual({
        template_version_id: extra.versionId,
      })
      expect(target.store.read(sourceTemplate.sourceDigest)).toEqual(source.store.read(sourceTemplate.sourceDigest))

      const repeated = await target.service.validateArchive(archive)
      expect(repeated.diff).toMatchObject({ activate: [], retire: [], update: [], reuse: [sourceTemplate.assetId] })
      await expect(target.service.apply(repeated.transferId, {
        expectedManifestSha256: repeated.manifestSha256,
        expectedTargetCatalogStateSha256: repeated.targetCatalogStateSha256,
      })).resolves.toMatchObject({ applied: true })
    } finally {
      source.database.close()
      target.database.close()
    }
  })

  it('rejects tampering, traversal, duplicate ids, missing objects and illegal renderer identities before catalog writes', async () => {
    const source = openState('p04-transfer-negative-source-')
    const target = openState('p04-transfer-negative-target-')
    try {
      registerFixture(source)
      const archive = await source.service.exportArchive()
      const targetCatalogBefore = catalogFingerprint(target.database)
      const digestTamper = await rewriteManifest(archive, (manifest) => {
        const files = manifest.files as Array<Record<string, unknown>>
        files[0].sha256 = 'f'.repeat(64)
      })
      await expectRejectedWithoutCatalogWrites(target, digestTamper, /hash|digest/i)

      const objectTamperZip = await JSZip.loadAsync(archive)
      const objectPath = Object.keys(objectTamperZip.files).find((name) => name.startsWith('objects/'))!
      objectTamperZip.file(objectPath, Buffer.from('tampered-object'), { createFolders: false })
      const objectTamper = await objectTamperZip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
      await expectRejectedWithoutCatalogWrites(target, objectTamper, /hash|size/i)

      const duplicateId = await rewriteManifest(archive, (manifest) => {
        const assets = manifest.assets as unknown[]
        assets.push(structuredClone(assets[0]))
      })
      await expectRejectedWithoutCatalogWrites(target, duplicateId, /duplicate/i)

      const missingObject = await rewriteManifest(archive, (manifest) => {
        const files = manifest.files as Array<Record<string, unknown>>
        files.pop()
      })
      await expectRejectedWithoutCatalogWrites(target, missingObject, /files|object|manifest/i)

      const missingEntryZip = await JSZip.loadAsync(archive)
      missingEntryZip.remove(Object.keys(missingEntryZip.files).find((name) => name.startsWith('objects/'))!)
      const missingEntry = await missingEntryZip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
      await expectRejectedWithoutCatalogWrites(target, missingEntry, /entries|files|object/i)

      const illegalRenderer = await rewriteManifest(archive, (manifest) => {
        const derivatives = manifest.derivatives as Array<Record<string, unknown>>
        derivatives[0].rendererVersion = '../renderer'
      })
      await expectRejectedWithoutCatalogWrites(target, illegalRenderer, /renderer/i)

      const zip = await JSZip.loadAsync(archive)
      zip.file('../escape', 'forbidden')
      const traversal = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
      await expectRejectedWithoutCatalogWrites(target, traversal, /unsafe path/i)
      expect(catalogFingerprint(target.database)).toBe(targetCatalogBefore)
      expect(existsSync(join(target.root, 'catalog-transfer-staging'))).toBe(false)
    } finally {
      source.database.close()
      target.database.close()
    }
  })

  it('fails closed on immutable version conflicts, stale target state and read-only apply', async () => {
    const source = openState('p04-transfer-conflict-source-')
    const target = openState('p04-transfer-conflict-target-')
    try {
      const registered = registerFixture(source)
      const archive = await source.service.exportArchive()
      const validation = await target.service.validateArchive(archive)
      const beforeStaleApply = catalogFingerprint(target.database)
      const beforeStaleCas = directoryFingerprint(join(target.root, 'objects'))
      target.database.prepare(
        'INSERT INTO template_assets (id, title, summary, category, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .run('target-drift', 'Target drift', '', 'fixture', 'active', 1, 1)
      const afterTargetDrift = catalogFingerprint(target.database)
      await expect(target.service.apply(validation.transferId, {
        expectedManifestSha256: validation.manifestSha256,
        expectedTargetCatalogStateSha256: validation.targetCatalogStateSha256,
      })).rejects.toThrow(/target catalog state changed/i)
      expect(catalogFingerprint(target.database)).not.toBe(beforeStaleApply)
      expect(catalogFingerprint(target.database)).toBe(afterTargetDrift)
      expect(directoryFingerprint(join(target.root, 'objects'))).toBe(beforeStaleCas)

      const conflict = openState('p04-transfer-version-conflict-')
      try {
        const template = adaptSimulatedTemplatePackage(fixture)
        conflict.database.prepare(
          'INSERT INTO template_assets (id, title, summary, category, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
          .run(template.asset.id, template.asset.title, template.asset.summary, template.asset.category, 'active', 1, 1)
        const conflicting = conflict.store.put(Buffer.from('conflicting package'), 'application/vnd.html-template-package+json')
        conflict.database.prepare(
          'INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)',
        )
          .run(conflicting.digest, conflicting.mediaType, conflicting.byteSize, conflicting.relativePath, 1)
        conflict.database.prepare(
          "INSERT INTO template_versions (id, asset_id, version_number, contract_version, source_digest, content_object_digest, slot_schema, status, created_at) VALUES (?, ?, 1, 'html-template/v1', ?, ?, '{\"slots\":[]}', 'verified', 1)",
        )
          .run(registered.versionId, registered.assetId, conflicting.digest, conflicting.digest)
        await expect(conflict.service.validateArchive(archive)).rejects.toThrow(/version.*conflict/i)
      } finally {
        conflict.database.close()
      }

      const readOnly = new CatalogTransferService({
        database: target.database as never,
        contentStore: target.store,
        stagingRoot: join(target.root, 'readonly-staging'),
        sourceReleaseSha: releaseSha,
        readOnly: true,
      })
      const readOnlyValidation: CatalogTransferValidation = await readOnly.validateArchive(archive)
      await expect(readOnly.apply(readOnlyValidation.transferId, {
        expectedManifestSha256: readOnlyValidation.manifestSha256,
        expectedTargetCatalogStateSha256: readOnlyValidation.targetCatalogStateSha256,
      })).rejects.toThrow(CatalogTransferError)
    } finally {
      source.database.close()
      target.database.close()
    }
  })

  it('reuses independently existing matching versions and renderer outputs by digest', async () => {
    const source = openState('p04-transfer-reuse-source-')
    const target = openState('p04-transfer-reuse-target-')
    try {
      const sourceTemplate = registerFixture(source)
      registerFixture(target)
      const archive = await source.service.exportArchive()
      const validation = await target.service.validateArchive(archive)
      expect(validation.diff).toEqual({ activate: [], update: [], reuse: [sourceTemplate.assetId], retire: [] })
      await expect(target.service.apply(validation.transferId, {
        expectedManifestSha256: validation.manifestSha256,
        expectedTargetCatalogStateSha256: validation.targetCatalogStateSha256,
      })).resolves.toMatchObject({ applied: true })
    } finally {
      source.database.close()
      target.database.close()
    }
  })

  it('updates source version status so a matching current version remains visible and the next apply is idempotent', async () => {
    const source = openState('p04-transfer-status-source-')
    const target = openState('p04-transfer-status-target-')
    try {
      const sourceTemplate = registerFixture(source)
      registerFixture(target)
      target.database.prepare('DROP TRIGGER template_versions_current_version_status').run()
      target.database.prepare("UPDATE template_versions SET status = 'unavailable' WHERE id = ?").run(sourceTemplate.versionId)
      target.database.prepare(`
        CREATE TRIGGER template_versions_current_version_status
        BEFORE UPDATE OF status ON template_versions
        WHEN OLD.status IN ('verified', 'available')
          AND NEW.status NOT IN ('verified', 'available')
          AND EXISTS (SELECT 1 FROM template_assets WHERE current_version_id = OLD.id)
        BEGIN
          SELECT RAISE(ABORT, 'current version must remain verified');
        END
      `).run()
      const protectedBefore = protectedFingerprint(target.database)
      const archive = await source.service.exportArchive()

      const validation = await target.service.validateArchive(archive)
      expect(validation.diff).toEqual({ activate: [], update: [sourceTemplate.assetId], reuse: [], retire: [] })
      await target.service.apply(validation.transferId, {
        expectedManifestSha256: validation.manifestSha256,
        expectedTargetCatalogStateSha256: validation.targetCatalogStateSha256,
      })

      expect(target.database.prepare('SELECT status FROM template_versions WHERE id = ?').get(sourceTemplate.versionId)).toEqual({
        status: 'verified',
      })
      const catalog = new AssetLibraryCatalog(target.database as never, target.store)
      expect(catalog.list({ kind: 'user', id: TEST_USER_ID }, parseCatalogQuery('http://127.0.0.1/api/catalog'))).toMatchObject({
        total: 1,
        items: [{ id: sourceTemplate.assetId, version: { status: 'verified' } }],
      })
      expect(protectedFingerprint(target.database)).toBe(protectedBefore)

      const repeated = await target.service.validateArchive(archive)
      expect(repeated.diff).toEqual({ activate: [], update: [], reuse: [sourceTemplate.assetId], retire: [] })
      await expect(target.service.apply(repeated.transferId, {
        expectedManifestSha256: repeated.manifestSha256,
        expectedTargetCatalogStateSha256: repeated.targetCatalogStateSha256,
      })).resolves.toMatchObject({ applied: true })
      expect(protectedFingerprint(target.database)).toBe(protectedBefore)
    } finally {
      source.database.close()
      target.database.close()
    }
  })

  it('replaces target-only derivatives on source versions and rejects inconsistent matching derivative metadata', async () => {
    const source = openState('p04-transfer-derivative-source-')
    const target = openState('p04-transfer-derivative-target-')
    try {
      const sourceTemplate = registerFixture(source)
      registerFixture(target)
      addRendererPair(target, sourceTemplate, 'p04-target-only-newer:1', 1_786_636_900_000)
      const derivativeDeleteGuardBefore = installCustomDerivativeDeleteGuard(target.database)
      const protectedBefore = protectedFingerprint(target.database)
      const archive = await source.service.exportArchive()

      const validation = await target.service.validateArchive(archive)
      expect(validation.diff).toEqual({ activate: [], update: [sourceTemplate.assetId], reuse: [], retire: [] })
      await target.service.apply(validation.transferId, {
        expectedManifestSha256: validation.manifestSha256,
        expectedTargetCatalogStateSha256: validation.targetCatalogStateSha256,
      })

      expect(target.database.prepare(
        'SELECT kind, content_digest, renderer_version, security_diagnostic, created_at FROM template_preview_derivatives WHERE template_version_id = ? ORDER BY kind',
      ).all(sourceTemplate.versionId)).toEqual(source.database.prepare(
        'SELECT kind, content_digest, renderer_version, security_diagnostic, created_at FROM template_preview_derivatives WHERE template_version_id = ? ORDER BY kind',
      ).all(sourceTemplate.versionId))
      expect(derivativeDeleteGuardSql(target.database)).toBe(derivativeDeleteGuardBefore)
      const catalog = new AssetLibraryCatalog(target.database as never, target.store)
      expect(catalog.list({ kind: 'user', id: TEST_USER_ID }, parseCatalogQuery('http://127.0.0.1/api/catalog'))).toMatchObject({
        total: 1,
        items: [{ id: sourceTemplate.assetId, derivative: { rendererVersion: 'p04-transfer-fixture:1' } }],
      })
      expect(protectedFingerprint(target.database)).toBe(protectedBefore)

      const repeated = await target.service.validateArchive(archive)
      expect(repeated.diff).toEqual({ activate: [], update: [], reuse: [sourceTemplate.assetId], retire: [] })
      await expect(target.service.apply(repeated.transferId, {
        expectedManifestSha256: repeated.manifestSha256,
        expectedTargetCatalogStateSha256: repeated.targetCatalogStateSha256,
      })).resolves.toMatchObject({ applied: true })
      expect(derivativeDeleteGuardSql(target.database)).toBe(derivativeDeleteGuardBefore)

      expect(() => target.database.prepare(
        'DELETE FROM template_preview_derivatives WHERE template_version_id = ?',
      ).run(sourceTemplate.versionId)).toThrow(/append-only/i)
      target.database.prepare('DROP TRIGGER template_preview_derivatives_append_only_update').run()
      target.database.prepare(
        "UPDATE template_preview_derivatives SET security_diagnostic = '{\"networkAccessBlocked\":false}' WHERE template_version_id = ? AND kind = 'preview' AND renderer_version = 'p04-transfer-fixture:1'",
      ).run(sourceTemplate.versionId)
      target.database.prepare(`
        CREATE TRIGGER template_preview_derivatives_append_only_update
        BEFORE UPDATE ON template_preview_derivatives
        BEGIN
          SELECT RAISE(ABORT, 'preview derivatives are append-only');
        END
      `).run()
      const catalogBeforeConflict = catalogFingerprint(target.database)
      await expect(target.service.validateArchive(archive)).rejects.toThrow(/derivative conflict/i)
      expect(catalogFingerprint(target.database)).toBe(catalogBeforeConflict)
      expect(protectedFingerprint(target.database)).toBe(protectedBefore)
    } finally {
      source.database.close()
      target.database.close()
    }
  })

  it('exposes exact administrator API status, media type, body bounds and read-only behavior', async () => {
    const source = openState('p04-transfer-api-source-')
    const target = openState('p04-transfer-api-target-')
    try {
      registerFixture(source)
      const admin = seedTestUser(source.database as never)
      const member = { ...admin, id: 'user-00000000-0000-4000-8000-000000000099', username: 'member9', role: 'member' as const }
      const unauthenticated = { authenticate: () => null, recordFailure: () => undefined }
      const sourceApp = createApp({ catalogTransfers: source.service, auth: createTrustedTestAuth(admin) })
      const memberApp = createApp({ catalogTransfers: source.service, auth: createTrustedTestAuth(member) })
      const anonymousApp = createApp({ catalogTransfers: source.service, auth: unauthenticated as never })

      expect((await anonymousApp.request('http://127.0.0.1:3001/api/admin/catalog-transfers/export')).status).toBe(401)
      expect((await memberApp.request('http://127.0.0.1:3001/api/admin/catalog-transfers/export')).status).toBe(403)
      const exported = await sourceApp.request('http://127.0.0.1:3001/api/admin/catalog-transfers/export')
      expect(exported.status).toBe(200)
      expect(exported.headers.get('content-type')).toContain('application/zip')
      expect(exported.headers.get('content-disposition')).toContain('asset-library-catalog-transfer.zip')
      const archive = new Uint8Array(await exported.arrayBuffer())

      const targetAdmin = seedTestUser(target.database as never)
      const targetApp = createApp({ catalogTransfers: target.service, auth: createTrustedTestAuth(targetAdmin) })
      const wrongType = await targetApp.request('http://127.0.0.1:3001/api/admin/catalog-transfers', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/octet-stream' },
        body: archive,
      })
      expect(wrongType.status).toBe(415)
      const oversized = await targetApp.request('http://127.0.0.1:3001/api/admin/catalog-transfers', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/zip', 'content-length': String(64 * 1024 * 1024 + 1) },
        body: Buffer.alloc(22),
      })
      expect(oversized.status).toBe(400)
      const staged = await targetApp.request('http://127.0.0.1:3001/api/admin/catalog-transfers', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/zip' },
        body: archive,
      })
      expect(staged.status).toBe(201)
      const stagedPayload = await staged.json() as { transfer: CatalogTransferValidation }

      const readOnlyService = new CatalogTransferService({
        database: target.database as never,
        contentStore: target.store,
        stagingRoot: join(target.root, 'catalog-transfer-staging'),
        sourceReleaseSha: releaseSha,
        readOnly: true,
      })
      const readOnlyApp = createApp({ catalogTransfers: readOnlyService, auth: createTrustedTestAuth(targetAdmin), readOnly: true })
      const restaged = await readOnlyApp.request('http://127.0.0.1:3001/api/admin/catalog-transfers', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/zip' },
        body: archive,
      })
      expect(restaged.status).toBe(201)
      const apply = await readOnlyApp.request(
        `http://127.0.0.1:3001/api/admin/catalog-transfers/${stagedPayload.transfer.transferId}/apply`,
        {
          method: 'POST',
          headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedManifestSha256: stagedPayload.transfer.manifestSha256,
            expectedTargetCatalogStateSha256: stagedPayload.transfer.targetCatalogStateSha256,
          }),
        },
      )
      expect(apply.status).toBe(503)
      await expect(apply.json()).resolves.toEqual({ error: 'APP_READ_ONLY' })
    } finally {
      source.database.close()
      target.database.close()
    }
  })

  it('rolls back every catalog table when a database write fails mid-apply', async () => {
    const source = openState('p04-transfer-rollback-source-')
    const target = openState('p04-transfer-rollback-target-')
    try {
      const registered = registerFixture(source)
      registerFixture(target)
      addRendererPair(target, registered, 'p04-target-only-rollback:1', 1_786_636_900_000)
      const derivativeDeleteGuardBefore = installCustomDerivativeDeleteGuard(target.database)
      const archive = await source.service.exportArchive()
      const validation = await target.service.validateArchive(archive)
      const before = catalogFingerprint(target.database)
      target.database.prepare(
        `CREATE TRIGGER p04_forced_apply_failure BEFORE UPDATE ON template_assets BEGIN SELECT RAISE(ABORT, 'forced apply failure'); END`,
      ).run()
      await expect(target.service.apply(validation.transferId, {
        expectedManifestSha256: validation.manifestSha256,
        expectedTargetCatalogStateSha256: validation.targetCatalogStateSha256,
      })).rejects.toThrow(/forced apply failure/i)
      expect(catalogFingerprint(target.database)).toBe(before)
      expect(derivativeDeleteGuardSql(target.database)).toBe(derivativeDeleteGuardBefore)
      expect(() => target.database.prepare(
        'DELETE FROM template_preview_derivatives WHERE template_version_id = ?',
      ).run(registered.versionId)).toThrow(/append-only/i)
    } finally {
      source.database.close()
      target.database.close()
    }
  })

  it('keeps the web BFF limited to the three reviewed catalog transfer endpoints', () => {
    const root = join(import.meta.dirname, '..', 'apps/web/src/routes/api/admin/catalog-transfers')
    const upload = readFileSync(join(root, '+server.ts'), 'utf8')
    const exportRoute = readFileSync(join(root, 'export/+server.ts'), 'utf8')
    const apply = readFileSync(join(root, '[transferId]/apply/+server.ts'), 'utf8')
    expect(upload).toContain("forwardBinary(event, '/api/admin/catalog-transfers', 'application/zip'")
    expect(exportRoute).toContain("forwardArtifact(event, '/api/admin/catalog-transfers/export', 'zip')")
    expect(apply).toContain('/^transfer-[0-9a-f]{64}$/')
    expect(apply).toContain('forwardJson(event, `/api/admin/catalog-transfers/${event.params.transferId}/apply`)')
    expect(`${upload}\n${exportRoute}\n${apply}`).not.toMatch(/\.\.\/|\[\.\.\.path\]/)
  })
})
