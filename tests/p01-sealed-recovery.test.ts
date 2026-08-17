import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { createStoredZip, readStoredZip } from '../apps/api/src/presentation-exports/offline-archive.js'
import { LocalRecoveryService, MAX_RECOVERY_ARCHIVE_BYTES } from '../apps/api/src/recovery/local-recovery.js'
import { createTrustedTestAuth, seedTestUser } from './p14-test-support.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  close(): void
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite

function fixture(faults?: ConstructorParameters<typeof LocalRecoveryService>[0]['faults']) {
  const directory = mkdtempSync(join(tmpdir(), 'asset-library-p01-sealed-'))
  const databasePath = join(directory, 'source/asset-library.db')
  const contentRoot = join(directory, 'source/objects')
  const backupRoot = join(directory, 'backups')
  const restoreRoot = join(directory, 'restores')
  const activationRequestPath = join(directory, 'source/recovery-activation.json')
  migrateDatabase(databasePath)
  mkdirSync(contentRoot, { recursive: true, mode: 0o700 })
  const service = new LocalRecoveryService({ databasePath, contentRoot, backupRoot, restoreRoot, activationRequestPath, faults })
  return { directory, databasePath, contentRoot, backupRoot, restoreRoot, activationRequestPath, service }
}

async function backedUpFixture() {
  const state = fixture()
  const overview = state.service.inspectCurrent()
  const backup = await state.service.createBackup(overview.stateSha256)
  const archivePath = join(state.backupRoot, `${backup.id}.zip`)
  return { ...state, overview, backup, archivePath, archive: readFileSync(archivePath) }
}

function materializeLegacy(archive: Buffer, root: string, backupId: string): string {
  const directory = join(root, backupId)
  for (const [relativePath, content] of readStoredZip(archive, { maxEntries: 5_002, maxBytes: MAX_RECOVERY_ARCHIVE_BYTES })) {
    const path = join(directory, relativePath)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, content, { mode: 0o600 })
  }
  return directory
}

function reorderedArchive(archive: Buffer): Buffer {
  const files = [...readStoredZip(archive, { maxEntries: 5_002, maxBytes: MAX_RECOVERY_ARCHIVE_BYTES })]
    .reverse()
    .map(([relativePath, content]) => ({ relativePath, content }))
  return createStoredZip(files, { maxEntries: 5_002, maxBytes: MAX_RECOVERY_ARCHIVE_BYTES })
}

function tamperDatabaseEntry(archive: Buffer): Buffer {
  const files = readStoredZip(archive, { maxEntries: 5_002, maxBytes: MAX_RECOVERY_ARCHIVE_BYTES })
  files.set('database/asset-library.db', Buffer.from('tampered SQLite bytes'))
  return createStoredZip([...files].map(([relativePath, content]) => ({ relativePath, content })), { maxEntries: 5_002, maxBytes: MAX_RECOVERY_ARCHIVE_BYTES })
}

describe('P01 sealed backup storage', () => {
  it('atomically persists one mode-0600 ZIP and always returns its verified original bytes', async () => {
    const state = await backedUpFixture()
    try {
      expect(state.backup).toMatchObject({ integrity: 'valid', storageKind: 'sealed-zip' })
      expect(existsSync(join(state.backupRoot, state.backup.id))).toBe(false)
      expect(statSync(state.archivePath).mode & 0o777).toBe(0o600)
      expect(state.service.readBackupArchive(state.backup.id)).toEqual(state.archive)
      expect(createHash('sha256').update(state.service.readBackupArchive(state.backup.id)).digest('hex')).toBe(createHash('sha256').update(state.archive).digest('hex'))
      expect(readdirSync(state.backupRoot)).toEqual([`${state.backup.id}.zip`])
    } finally { rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('keeps a valid legacy directory readable and restorable without migrating or deleting it', async () => {
    const state = await backedUpFixture()
    try {
      const legacyDirectory = materializeLegacy(state.archive, state.backupRoot, state.backup.id)
      unlinkSync(state.archivePath)
      expect(state.service.inspectCurrent().backups).toEqual([
        expect.objectContaining({ id: state.backup.id, integrity: 'valid', storageKind: 'legacy-directory' }),
      ])
      expect(readStoredZip(state.service.readBackupArchive(state.backup.id), { maxEntries: 5_002, maxBytes: MAX_RECOVERY_ARCHIVE_BYTES }).has('database/asset-library.db')).toBe(true)
      expect(state.service.restoreBackup(state.backup.id, state.backup.manifestSha256)).toMatchObject({ backupId: state.backup.id })
      expect(existsSync(legacyDirectory)).toBe(true)
      expect(existsSync(state.archivePath)).toBe(false)
    } finally { rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('cleans the temporary archive when the atomic commit seam fails', async () => {
    const state = fixture({ beforeArchiveCommit: () => { throw new Error('sensitive-fixture-marker') } })
    const source = await backedUpFixture()
    const importTarget = fixture({ beforeArchiveCommit: () => { throw new Error('simulated import interruption') } })
    try {
      const overview = state.service.inspectCurrent()
      let diagnostic = ''
      try { await state.service.createBackup(overview.stateSha256) } catch (error) { diagnostic = (error as Error).message }
      expect(diagnostic).toBe('Local backup creation failed')
      expect(diagnostic).not.toContain('sensitive-fixture-marker')
      expect(readdirSync(state.backupRoot)).toEqual([])
      expect(() => importTarget.service.importBackupArchive(source.archive)).toThrow(/import failed/)
      expect(readdirSync(importTarget.backupRoot)).toEqual([])
    } finally {
      rmSync(state.directory, { recursive: true, force: true })
      rmSync(source.directory, { recursive: true, force: true })
      rmSync(importTarget.directory, { recursive: true, force: true })
    }
  })

  it('imports identical sealed bytes idempotently but rejects byte-different and legacy collisions', async () => {
    const source = await backedUpFixture()
    const destination = fixture()
    try {
      const imported = destination.service.importBackupArchive(source.archive)
      const importedPath = join(destination.backupRoot, `${source.backup.id}.zip`)
      expect(readFileSync(importedPath)).toEqual(source.archive)
      expect(statSync(importedPath).mode & 0o777).toBe(0o600)
      expect(destination.service.importBackupArchive(source.archive)).toEqual(imported)
      const sameManifestDifferentBytes = reorderedArchive(source.archive)
      expect(sameManifestDifferentBytes.equals(source.archive)).toBe(false)
      expect(() => destination.service.importBackupArchive(sameManifestDifferentBytes)).toThrow(/different archive bytes/)

      rmSync(destination.backupRoot, { recursive: true, force: true })
      mkdirSync(destination.backupRoot, { recursive: true })
      materializeLegacy(source.archive, destination.backupRoot, source.backup.id)
      expect(() => destination.service.importBackupArchive(source.archive)).toThrow(/different storage/)
    } finally {
      rmSync(source.directory, { recursive: true, force: true })
      rmSync(destination.directory, { recursive: true, force: true })
    }
  })
})

describe('P01 invalid backup isolation and fail-closed roots', () => {
  it('returns a controlled invalid item while exact operations stay 409 and missing stays 404', async () => {
    const state = await backedUpFixture()
    try {
      writeFileSync(state.archivePath, tamperDatabaseEntry(state.archive))
      const database = new Database(state.databasePath)
      const user = seedTestUser(database as never)
      database.close()
      const app = createApp({ recovery: state.service, auth: createTrustedTestAuth(user) })
      const root = 'http://127.0.0.1:3001/api/recovery'
      const overviewResponse = await app.request(root)
      expect(overviewResponse.status).toBe(200)
      const overview = (await overviewResponse.json() as { recovery: { stateSha256: string; backups: Array<Record<string, unknown>> } }).recovery
      expect(overview.stateSha256).toBeTruthy()
      expect(overview.backups).toEqual([{
        id: state.backup.id,
        integrity: 'invalid',
        storageKind: 'sealed-zip',
        diagnostic: 'Sealed backup failed integrity verification.',
      }])
      expect(await app.request(`${root}/backups/${state.backup.id}/manifest`).then((response) => response.status)).toBe(409)
      expect(await app.request(`${root}/backups/${state.backup.id}/archive`).then((response) => response.status)).toBe(409)
      const origin = { origin: 'http://127.0.0.1:5173' }
      expect(await app.request(`${root}/backups/${state.backup.id}/restore`, { method: 'POST', headers: origin, body: JSON.stringify({ expectedManifestSha256: state.backup.manifestSha256 }) }).then((response) => response.status)).toBe(409)
      expect(await app.request(`${root}/backups/${state.backup.id}/activate`, { method: 'POST', headers: origin, body: JSON.stringify({ expectedManifestSha256: state.backup.manifestSha256, confirmation: `ACTIVATE ${state.backup.id}` }) }).then((response) => response.status)).toBe(409)
      expect(await app.request(`${root}/backups/backup-missing/manifest`).then((response) => response.status)).toBe(404)
      expect(existsSync(state.restoreRoot)).toBe(false)
      expect(existsSync(state.activationRequestPath)).toBe(false)
    } finally { rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('treats a directory/ZIP duplicate id as one conflict and never chooses either copy', async () => {
    const state = await backedUpFixture()
    try {
      materializeLegacy(state.archive, state.backupRoot, state.backup.id)
      expect(state.service.inspectCurrent().backups).toEqual([{
        id: state.backup.id,
        integrity: 'invalid',
        storageKind: 'conflict',
        diagnostic: 'Backup storage conflict requires operator review.',
      }])
      expect(() => state.service.readBackupManifest(state.backup.id)).toThrow(CONFLICT_DIAGNOSTIC_PATTERN)
      expect(() => state.service.importBackupArchive(state.archive)).toThrow(/different storage/)
    } finally { rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('fails the whole overview for current DB, CAS, backup-root, count and archive-size boundaries', async () => {
    const cases = ['database', 'cas', 'root', 'count'] as const
    for (const fault of cases) {
      const state = fixture()
      try {
        if (fault === 'database') unlinkSync(state.databasePath)
        if (fault === 'cas') rmSync(state.contentRoot, { recursive: true, force: true })
        if (fault === 'root') writeFileSync(state.backupRoot, 'not a directory')
        if (fault === 'count') {
          mkdirSync(state.backupRoot, { recursive: true })
          for (let index = 0; index < 21; index += 1) mkdirSync(join(state.backupRoot, `backup-count-${index}`))
        }
        expect(() => state.service.inspectCurrent()).toThrow()
      } finally { rmSync(state.directory, { recursive: true, force: true }) }
    }

    const state = fixture()
    try {
      expect(() => state.service.importBackupArchive(Buffer.alloc(21))).toThrow(/size/)
      expect(() => state.service.readBackupManifest('../escape')).toThrow(/invalid|escapes/)
      expect(MAX_RECOVERY_ARCHIVE_BYTES).toBe(128 * 1024 * 1024)
    } finally { rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('renders invalid backups as generic inert rows with no recovery controls', () => {
    const types = readFileSync(join(process.cwd(), 'apps/web/src/lib/recovery.ts'), 'utf8')
    const page = readFileSync(join(process.cwd(), 'apps/web/src/routes/(app)/admin/+page.svelte'), 'utf8')
    const invalidType = types.slice(types.indexOf('export type RecoveryInvalidBackup'), types.indexOf('export type RecoveryBackup ='))
    const invalidBranch = page.slice(page.indexOf('{:else}<span><strong>备份已隔离'), page.indexOf('{/if}</li>{/each}</ul>'))
    expect(invalidType).not.toMatch(/manifestSha256|manifestUrl|archiveUrl|restored/)
    expect(page).toContain("{#if backup.integrity === 'valid'}")
    expect(invalidBranch).toContain('备份已隔离')
    expect(invalidBranch).toContain('未通过完整性校验，请联系管理员核查。')
    expect(invalidBranch).not.toMatch(/<button|<a\b|manifestUrl|archiveUrl|restored/)
  })
})

const CONFLICT_DIAGNOSTIC_PATTERN = /storage conflict/i
