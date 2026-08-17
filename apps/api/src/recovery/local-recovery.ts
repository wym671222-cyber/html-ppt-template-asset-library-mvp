import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'
import { LocalContentStore } from '../assets/content-store.js'
import { TARGET_DATABASE_TABLES } from '../db/migrate.js'
import { MIGRATIONS_DIRECTORY } from '../db/paths.js'
import { getOwnerContext } from '../owner.js'
import { PresentationExportRepository } from '../presentation-exports/presentation-export-repository.js'
import { createStoredZip, readStoredZip } from '../presentation-exports/offline-archive.js'

const BACKUP_CONTRACT = 'asset-library-local-backup/v1' as const
const RESTORE_CONTRACT = 'asset-library-local-restore/v1' as const
const ACTIVATION_CONTRACT = 'asset-library-recovery-activation/v1' as const
const SHA256 = /^[0-9a-f]{64}$/
const CONTROLLED_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_OBJECTS = 5_000
const MAX_DERIVATIVES = 10_000
const MAX_PRESENTATIONS = 1_000
const MAX_ITEMS = 10_000
const MAX_EXPORTS = 1_000
const MAX_BACKUPS = 20
export const MAX_RECOVERY_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_RECOVERY_ARCHIVE_FILES = MAX_OBJECTS + 2
const DATABASE_RELATIVE_PATH = 'database/asset-library.db' as const
const MANIFEST_RELATIVE_PATH = 'backup-manifest.json' as const
const SEALED_BACKUP_SUFFIX = '.zip' as const
const INVALID_SEALED_DIAGNOSTIC = 'Sealed backup failed integrity verification.' as const
const INVALID_LEGACY_DIAGNOSTIC = 'Legacy backup failed integrity verification.' as const
const CONFLICT_DIAGNOSTIC = 'Backup storage conflict requires operator review.' as const

export class RecoveryRequestError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 500 = 409) {
    const bounded = message
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\b(password|token|secret|credential|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
      .replace(/(?:\/[^\s"'():]+){2,}/g, '[path]')
      .slice(0, 300)
    super(bounded || 'Local recovery request failed')
  }
}

export type MigrationLedgerEntry = Readonly<{
  sequence: number
  tag: string
  sha256: string
  createdAt: number
}>

export type BackupObjectEntry = Readonly<{
  digest: string
  relativePath: string
  mediaType: string
  byteSize: number
  roles: string[]
}>

export type BackupDerivativeEntry = Readonly<{
  templateVersionId: string
  kind: 'preview' | 'thumbnail'
  sourceSha256: string
  contentSha256: string
  rendererVersion: string
  securityDiagnosticSha256: string
}>

export type BackupPresentationEntry = Readonly<{
  id: string
  ownerUserId: string
  revision: number
  itemCount: number
  items: Array<{
    id: string
    position: number
    templateVersionId: string
    contentObjectSha256: string
    slotOverridesSha256: string
  }>
}>

export type BackupExportEntry = Readonly<{
  id: string
  ownerUserId: string
  presentationId: string
  presentationRevision: number
  manifestSha256: string
  htmlSha256: string
  zipSha256: string
}>

export type LocalBackupManifest = Readonly<{
  contractVersion: typeof BACKUP_CONTRACT
  backupId: string
  createdAt: number
  source: {
    stateSha256: string
    databaseSha256Before: string
    databaseSha256After: string
  }
  database: {
    relativePath: typeof DATABASE_RELATIVE_PATH
    sha256: string
    byteSize: number
    logicalSha256: string
    quickCheck: 'ok'
    foreignKeys: true
    foreignKeyCheckCount: 0
    migrationLedger: MigrationLedgerEntry[]
  }
  objects: BackupObjectEntry[]
  derivatives: BackupDerivativeEntry[]
  presentations: BackupPresentationEntry[]
  exports: BackupExportEntry[]
}>

export type RecoveryBackupStorageKind = 'sealed-zip' | 'legacy-directory'

export type RecoveryValidBackupSummary = Readonly<{
  id: string
  integrity: 'valid'
  storageKind: RecoveryBackupStorageKind
  createdAt: number
  stateSha256: string
  manifestSha256: string
  objectCount: number
  derivativeCount: number
  presentationCount: number
  exportCount: number
  manifestUrl: string
  archiveUrl: string
  restored: boolean
}>

export type RecoveryInvalidBackupSummary = Readonly<{
  id: string
  integrity: 'invalid'
  storageKind: RecoveryBackupStorageKind | 'conflict'
  diagnostic: typeof INVALID_SEALED_DIAGNOSTIC | typeof INVALID_LEGACY_DIAGNOSTIC | typeof CONFLICT_DIAGNOSTIC
}>

export type RecoveryBackupSummary = RecoveryValidBackupSummary | RecoveryInvalidBackupSummary

export type RecoveryRestoreSummary = Readonly<{
  id: string
  backupId: string
  verifiedAt: number
  databaseSha256: string
  stateSha256: string
  objectCount: number
  derivativeCount: number
  presentationCount: number
  exportCount: number
}>

export type RecoveryActivationSummary = Readonly<{
  id: string
  backupId: string
  stateSha256: string
  stagedAt: number
  restartRequired: true
}>

type RecoveryActivationRequest = Readonly<{
  contractVersion: typeof ACTIVATION_CONTRACT
  id: string
  backupId: string
  manifestSha256: string
  stateSha256: string
  stagedAt: number
}>

export type RecoveryOverview = Readonly<{
  stateSha256: string
  databaseSha256: string
  migrationCount: number
  objectCount: number
  derivativeCount: number
  presentationCount: number
  exportCount: number
  backups: RecoveryBackupSummary[]
}>

export type RecoveryFaultHooks = Readonly<{
  afterDatabaseSnapshot?: () => void
  afterBackupObject?: (copiedCount: number) => void
  beforeArchiveCommit?: () => void
  afterRestoreObject?: (copiedCount: number) => void
}>

type DatabaseIndex = Readonly<{
  logicalSha256: string
  stateSha256: string
  sessionCount: number
  migrationLedger: MigrationLedgerEntry[]
  objects: BackupObjectEntry[]
  derivatives: BackupDerivativeEntry[]
  presentations: BackupPresentationEntry[]
  exports: BackupExportEntry[]
}>

type ValidatedBackup = Readonly<{
  storageKind: RecoveryBackupStorageKind
  directory?: string
  files?: ReadonlyMap<string, Buffer>
  archiveBytes?: Buffer
  manifest: LocalBackupManifest
  manifestSha256: string
  index: DatabaseIndex
}>

type BackupStorageRecord = Readonly<{
  id: string
  directoryPath?: string
  archivePath?: string
}>

type ContentRow = {
  digest: string
  media_type: string
  byte_size: number
  relative_path: string
}

type DerivativeRow = {
  template_version_id: string
  kind: 'preview' | 'thumbnail'
  source_digest: string
  content_digest: string
  renderer_version: string
  security_diagnostic: string
}

function sha256(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex')
}

function sha256File(path: string): string {
  return sha256(readFileSync(path))
}

function canonical(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' && /^[A-Z0-9_]{2,30}$/.test(error.code) ? ` (${error.code})` : ''
}

function wrapFailure(error: unknown, message: string, status: 400 | 404 | 409 | 500 = 409): RecoveryRequestError {
  return error instanceof RecoveryRequestError ? error : new RecoveryRequestError(`${message}${errorCode(error)}`, status)
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new RecoveryRequestError(`${label} must be a lowercase SHA-256 value`, 400)
}

function assertControlledId(value: string, label: string): void {
  if (value.length > 180 || !CONTROLLED_ID.test(value)) throw new RecoveryRequestError(`${label} is invalid`, 400)
}

function controlledChild(root: string, id: string, label: string): string {
  assertControlledId(id, label)
  const path = resolve(root, id)
  const fromRoot = relative(root, path)
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || fromRoot.includes(sep)) throw new RecoveryRequestError(`${label} escapes its controlled root`, 400)
  return path
}

function controlledArchivePath(root: string, backupId: string): string {
  assertControlledId(backupId, 'Backup id')
  const filename = `${backupId}${SEALED_BACKUP_SUFFIX}`
  const path = resolve(root, filename)
  if (relative(root, path) !== filename) throw new RecoveryRequestError('Backup id escapes its controlled root', 400)
  return path
}

function assertRegularFile(path: string, label: string): void {
  if (!existsSync(path)) throw new RecoveryRequestError(`${label} is missing`)
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new RecoveryRequestError(`${label} must be a regular non-symbolic file`)
}

function assertDirectory(path: string, label: string): void {
  if (!existsSync(path)) throw new RecoveryRequestError(`${label} is missing`)
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RecoveryRequestError(`${label} must be a non-symbolic directory`)
}

function ensureWritableRoot(path: string, label: string): void {
  try {
    mkdirSync(path, { recursive: true, mode: 0o700 })
    assertDirectory(path, label)
  } catch (error) {
    throw wrapFailure(error, `${label} is not writable`)
  }
}

function writeExclusive(path: string, content: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(descriptor, content)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

function readValidatedBackupFile(validated: ValidatedBackup, relativePath: string): Buffer {
  const sealed = validated.files?.get(relativePath)
  if (sealed) return Buffer.from(sealed)
  if (!validated.directory) throw new RecoveryRequestError('Validated backup storage is unavailable')
  return readFileSync(join(validated.directory, relativePath))
}

function objectBackupPath(digest: string): string {
  assertSha256(digest, 'Content object digest')
  return `objects/sha256/${digest.slice(0, 2)}/${digest}`
}

function assertSafeManifestPath(path: string): void {
  if (!path || path.length > 240 || path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes(':') || !/^[a-z0-9][a-z0-9._/-]*$/.test(path)) {
    throw new RecoveryRequestError('Backup manifest contains an unsafe relative path')
  }
}

function listControlledFiles(root: string): string[] {
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const fromRoot = relative(root, path).split(sep).join('/')
      assertSafeManifestPath(fromRoot)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw new RecoveryRequestError('Backup contains a symbolic link')
      if (stat.isDirectory()) walk(path)
      else if (stat.isFile()) files.push(fromRoot)
      else throw new RecoveryRequestError('Backup contains an unsupported filesystem entry')
    }
  }
  walk(root)
  return files.sort()
}

function expectedMigrationLedger(): MigrationLedgerEntry[] {
  const journalPath = join(MIGRATIONS_DIRECTORY, 'meta/_journal.json')
  assertRegularFile(journalPath, 'Migration journal')
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(journalPath, 'utf8')) } catch { throw new RecoveryRequestError('Migration journal is malformed', 500) }
  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) throw new RecoveryRequestError('Migration journal is malformed', 500)
  return parsed.entries.map((value, index) => {
    if (!isRecord(value) || value.idx !== index || typeof value.tag !== 'string' || !/^\d{4}_[a-z0-9_]+$/.test(value.tag) || !Number.isInteger(value.when)) {
      throw new RecoveryRequestError('Migration journal contains an invalid entry', 500)
    }
    const sqlPath = join(MIGRATIONS_DIRECTORY, `${value.tag}.sql`)
    assertRegularFile(sqlPath, 'Migration SQL')
    return { sequence: index + 1, tag: value.tag, sha256: sha256File(sqlPath), createdAt: value.when as number }
  })
}

function assertPng(content: Buffer, kind: 'preview' | 'thumbnail'): void {
  const width = kind === 'preview' ? 1280 : 320
  const height = kind === 'preview' ? 720 : 180
  if (content.length < 24
    || content.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || content.subarray(12, 16).toString('ascii') !== 'IHDR'
    || content.readUInt32BE(16) !== width
    || content.readUInt32BE(20) !== height) {
    throw new RecoveryRequestError(`P05 ${kind} derivative is not the required PNG`)
  }
}

function assertSecurityDiagnostic(value: string): void {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new RecoveryRequestError('P05 security diagnostic is malformed') }
  if (!isRecord(parsed)
    || !Number.isInteger(parsed.allowedRequestCount) || Number(parsed.allowedRequestCount) < 1
    || parsed.blockedRequestCount !== 0
    || parsed.blockedSecurityEventCount !== 0
    || parsed.cookieHeaderCount !== 0
    || parsed.contextCookieCount !== 0
    || parsed.documentCookiePresent !== false
    || parsed.forbiddenDomNodeCount !== 0
    || parsed.newWindowCount !== 0) {
    throw new RecoveryRequestError('P05 security diagnostic does not prove an isolated render')
  }
}

function inspectDatabase(databasePath: string): DatabaseIndex {
  assertRegularFile(databasePath, 'SQLite database')
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    database.pragma('query_only = ON')
    database.pragma('foreign_keys = ON')
    if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new RecoveryRequestError('SQLite quick_check failed')
    if (database.pragma('foreign_keys', { simple: true }) !== 1) throw new RecoveryRequestError('SQLite foreign_keys is not enabled')
    if ((database.prepare('PRAGMA foreign_key_check').all() as unknown[]).length !== 0) throw new RecoveryRequestError('SQLite foreign_key_check found violations')

    const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name)
    const expectedTables = [...TARGET_DATABASE_TABLES].sort()
    if (JSON.stringify(tables) !== JSON.stringify(expectedTables)) throw new RecoveryRequestError('SQLite contains an unknown or missing target table')

    const expectedLedger = expectedMigrationLedger()
    const ledgerRows = database.prepare('SELECT rowid AS sequence, hash, created_at FROM __drizzle_migrations ORDER BY rowid').all() as { sequence: number; hash: string; created_at: number }[]
    const migrationLedger = ledgerRows.map((row, index) => ({ sequence: row.sequence, tag: expectedLedger[index]?.tag ?? '', sha256: row.hash, createdAt: row.created_at }))
    if (JSON.stringify(migrationLedger) !== JSON.stringify(expectedLedger)) throw new RecoveryRequestError('SQLite migration ledger does not match the numbered migrations')

    const logicalTables = Object.fromEntries(TARGET_DATABASE_TABLES.map((table) => [table, database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]))
    const logicalSha256 = sha256(JSON.stringify(logicalTables))

    const contentRows = database.prepare('SELECT digest, media_type, byte_size, relative_path FROM content_objects ORDER BY digest').all() as ContentRow[]
    if (contentRows.length > MAX_OBJECTS) throw new RecoveryRequestError(`Backup is limited to ${MAX_OBJECTS} content objects`)
    const roles = new Map(contentRows.map((row) => [row.digest, new Set<string>()]))
    for (const row of contentRows) {
      assertSha256(row.digest, 'Registered content digest')
      if (!row.media_type || /[\u0000-\u001f\u007f]/.test(row.media_type) || !Number.isInteger(row.byte_size) || row.byte_size < 0 || row.relative_path !== `sha256/${row.digest.slice(0, 2)}/${row.digest}`) {
        throw new RecoveryRequestError('Registered content object metadata is invalid')
      }
    }

    const versions = database.prepare('SELECT id, source_digest, content_object_digest FROM template_versions ORDER BY id').all() as { id: string; source_digest: string; content_object_digest: string | null }[]
    for (const version of versions) {
      assertSha256(version.source_digest, 'TemplateVersion source digest')
      if (version.content_object_digest) {
        if (version.content_object_digest !== version.source_digest || !roles.has(version.content_object_digest)) throw new RecoveryRequestError('TemplateVersion content object identity is invalid')
        roles.get(version.content_object_digest)!.add('template-package')
      }
    }

    const derivativeRows = database.prepare(`SELECT template_version_id, kind, source_digest, content_digest, renderer_version, security_diagnostic FROM template_preview_derivatives ORDER BY template_version_id, renderer_version, kind, content_digest`).all() as DerivativeRow[]
    if (derivativeRows.length > MAX_DERIVATIVES) throw new RecoveryRequestError(`Backup is limited to ${MAX_DERIVATIVES} derivatives`)
    const derivativePairs = new Map<string, Set<string>>()
    const derivatives = derivativeRows.map((row) => {
      if (row.kind !== 'preview' && row.kind !== 'thumbnail') throw new RecoveryRequestError('P05 derivative kind is invalid')
      assertSha256(row.source_digest, 'P05 source digest')
      assertSha256(row.content_digest, 'P05 content digest')
      if (!row.renderer_version || /[\u0000-\u001f\u007f]/.test(row.renderer_version) || !roles.has(row.source_digest) || !roles.has(row.content_digest)) throw new RecoveryRequestError('P05 derivative identity is invalid')
      assertSecurityDiagnostic(row.security_diagnostic)
      roles.get(row.source_digest)!.add('template-package')
      roles.get(row.content_digest)!.add(row.kind)
      const pairKey = `${row.template_version_id}\u0000${row.source_digest}\u0000${row.renderer_version}`
      const kinds = derivativePairs.get(pairKey) ?? new Set<string>()
      kinds.add(row.kind)
      derivativePairs.set(pairKey, kinds)
      return {
        templateVersionId: row.template_version_id,
        kind: row.kind,
        sourceSha256: row.source_digest,
        contentSha256: row.content_digest,
        rendererVersion: row.renderer_version,
        securityDiagnosticSha256: sha256(row.security_diagnostic),
      }
    })
    for (const kinds of derivativePairs.values()) if (kinds.size !== 2 || !kinds.has('preview') || !kinds.has('thumbnail')) throw new RecoveryRequestError('P05 derivative pair is incomplete')

    const presentationRows = database.prepare('SELECT id, owner_user_id, revision FROM presentations ORDER BY id').all() as { id: string; owner_user_id: string; revision: number }[]
    if (presentationRows.length > MAX_PRESENTATIONS) throw new RecoveryRequestError(`Backup is limited to ${MAX_PRESENTATIONS} presentations`)
    let totalItems = 0
    const presentations = presentationRows.map((presentation) => {
      const items = database.prepare(`SELECT item.id, item.position, item.template_version_id, item.slot_overrides, version.content_object_digest FROM presentation_items item JOIN template_versions version ON version.id = item.template_version_id WHERE item.presentation_id = ? ORDER BY item.position, item.id`).all(presentation.id) as { id: string; position: number; template_version_id: string; slot_overrides: string; content_object_digest: string | null }[]
      totalItems += items.length
      if (totalItems > MAX_ITEMS || items.some((item, index) => item.position !== index)) throw new RecoveryRequestError('Presentation item positions or count are invalid')
      return {
        id: presentation.id,
        ownerUserId: presentation.owner_user_id,
        revision: presentation.revision,
        itemCount: items.length,
        items: items.map((item) => {
          if (!item.content_object_digest || !roles.has(item.content_object_digest)) throw new RecoveryRequestError('PresentationItem does not fix a verified TemplateVersion content object')
          let overrides: unknown
          try { overrides = JSON.parse(item.slot_overrides) } catch { throw new RecoveryRequestError('PresentationItem slot overrides are malformed') }
          if (!isRecord(overrides)) throw new RecoveryRequestError('PresentationItem slot overrides are malformed')
          return {
            id: item.id,
            position: item.position,
            templateVersionId: item.template_version_id,
            contentObjectSha256: item.content_object_digest,
            slotOverridesSha256: sha256(item.slot_overrides),
          }
        }),
      }
    })

    const exportRows = database.prepare('SELECT export.id, presentation.owner_user_id, export.presentation_id, export.presentation_revision, export.manifest_digest, export.html_digest, export.zip_digest FROM presentation_exports export JOIN presentations presentation ON presentation.id = export.presentation_id ORDER BY export.id').all() as { id: string; owner_user_id: string; presentation_id: string; presentation_revision: number; manifest_digest: string; html_digest: string; zip_digest: string }[]
    if (exportRows.length > MAX_EXPORTS) throw new RecoveryRequestError(`Backup is limited to ${MAX_EXPORTS} exports`)
    const exports = exportRows.map((row) => {
      for (const [digest, role] of [[row.manifest_digest, 'export-manifest'], [row.html_digest, 'export-html'], [row.zip_digest, 'export-zip']] as const) {
        assertSha256(digest, 'P08 export digest')
        if (!roles.has(digest)) throw new RecoveryRequestError('P08 export references an unregistered content object')
        roles.get(digest)!.add(role)
      }
      return { id: row.id, ownerUserId: row.owner_user_id, presentationId: row.presentation_id, presentationRevision: row.presentation_revision, manifestSha256: row.manifest_digest, htmlSha256: row.html_digest, zipSha256: row.zip_digest }
    })

    const jobOutputs = database.prepare('SELECT output_digest FROM jobs WHERE output_digest IS NOT NULL ORDER BY output_digest').all() as { output_digest: string }[]
    for (const { output_digest: digest } of jobOutputs) {
      if (!roles.has(digest)) throw new RecoveryRequestError('Job output references an unregistered content object')
      roles.get(digest)!.add('job-output')
    }

    const objects = contentRows.map((row) => ({
      digest: row.digest,
      relativePath: objectBackupPath(row.digest),
      mediaType: row.media_type,
      byteSize: row.byte_size,
      roles: [...(roles.get(row.digest) ?? new Set<string>())].sort().length ? [...roles.get(row.digest)!].sort() : ['content-object'],
    }))
    const sessionCount = (database.prepare('SELECT count(*) AS count FROM sessions').get() as { count: number }).count
    const stateSha256 = sha256(JSON.stringify({ logicalSha256, migrationLedger, objects, derivatives, presentations, exports }))
    return { logicalSha256, stateSha256, sessionCount, migrationLedger, objects, derivatives, presentations, exports }
  } catch (error) {
    throw wrapFailure(error, 'SQLite recovery preflight failed')
  } finally {
    database.close()
  }
}

function verifyContentFiles(contentRoot: string, index: DatabaseIndex, requireRoot = false): void {
  if (index.objects.length === 0) {
    if (requireRoot) assertDirectory(contentRoot, 'Content object root')
    return
  }
  assertDirectory(contentRoot, 'Content object root')
  const store = new LocalContentStore(contentRoot)
  for (const object of index.objects) {
    const sourcePath = join(store.root, store.relativePathFor(object.digest))
    assertRegularFile(sourcePath, 'Registered content object')
    const bytes = readFileSync(sourcePath)
    if (bytes.byteLength !== object.byteSize || sha256(bytes) !== object.digest) throw new RecoveryRequestError('Registered content object hash or size verification failed')
  }
  for (const derivative of index.derivatives) assertPng(store.read(derivative.contentSha256), derivative.kind)
}

function verifyExports(databasePath: string, contentRoot: string, index: DatabaseIndex): void {
  if (index.exports.length === 0) return
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    database.pragma('query_only = ON')
    database.pragma('foreign_keys = ON')
    const exports = new PresentationExportRepository(database, new LocalContentStore(contentRoot))
    for (const record of index.exports) {
      const owner = getOwnerContext(record.ownerUserId)
      const manifest = exports.readManifest(owner, record.presentationId, record.id)
      if (manifest.presentation.revision !== record.presentationRevision
        || manifest.ownerUserId !== record.ownerUserId
        || manifest.package.htmlSha256 !== record.htmlSha256
        || manifest.package.zipSha256 !== record.zipSha256) throw new RecoveryRequestError('P08 export manifest does not match its fixed index')
      exports.readArtifact(owner, record.presentationId, record.id, 'html')
      exports.readArtifact(owner, record.presentationId, record.id, 'zip')
    }
  } catch (error) {
    throw wrapFailure(error, 'P08 export recovery verification failed')
  } finally {
    database.close()
  }
}

function inspectIsolatedDatabaseCopy(databasePath: string, contentRoot?: string): DatabaseIndex {
  const validationRoot = mkdtempSync(join(tmpdir(), 'asset-library-p09-validation-'))
  const validationDatabase = join(validationRoot, 'asset-library.db')
  try {
    writeExclusive(validationDatabase, readFileSync(databasePath))
    const index = inspectDatabase(validationDatabase)
    if (contentRoot !== undefined) {
      verifyContentFiles(contentRoot, index)
      verifyExports(validationDatabase, contentRoot, index)
    }
    return index
  } finally {
    rmSync(validationRoot, { recursive: true, force: true })
  }
}

function parseManifest(content: Buffer): LocalBackupManifest {
  if (content.byteLength < 2 || content.byteLength > 5_000_000) throw new RecoveryRequestError('Backup manifest size is invalid')
  let parsed: unknown
  try { parsed = JSON.parse(content.toString('utf8')) } catch { throw new RecoveryRequestError('Backup manifest is malformed') }
  if (!isRecord(parsed) || canonical(parsed) !== content.toString('utf8')) throw new RecoveryRequestError('Backup manifest is not canonical JSON')
  const manifest = parsed as unknown as LocalBackupManifest
  const keys = Object.keys(parsed).sort().join(',')
  if (keys !== 'backupId,contractVersion,createdAt,database,derivatives,exports,objects,presentations,source'
    || manifest.contractVersion !== BACKUP_CONTRACT
    || typeof manifest.backupId !== 'string'
    || !Number.isInteger(manifest.createdAt)
    || !isRecord(manifest.source)
    || !isRecord(manifest.database)
    || !Array.isArray(manifest.objects)
    || !Array.isArray(manifest.derivatives)
    || !Array.isArray(manifest.presentations)
    || !Array.isArray(manifest.exports)) throw new RecoveryRequestError('Backup manifest shape is invalid')
  assertControlledId(manifest.backupId, 'Backup id')
  assertSha256(manifest.source.stateSha256, 'Backup source state')
  assertSha256(manifest.source.databaseSha256Before, 'Backup source database hash')
  assertSha256(manifest.source.databaseSha256After, 'Backup source database hash')
  if (manifest.database.relativePath !== DATABASE_RELATIVE_PATH || manifest.database.quickCheck !== 'ok' || manifest.database.foreignKeys !== true || manifest.database.foreignKeyCheckCount !== 0 || !Array.isArray(manifest.database.migrationLedger)) throw new RecoveryRequestError('Backup database manifest is invalid')
  assertSha256(manifest.database.sha256, 'Backup database hash')
  assertSha256(manifest.database.logicalSha256, 'Backup logical database hash')
  for (const object of manifest.objects) {
    if (!object || typeof object.relativePath !== 'string' || typeof object.mediaType !== 'string' || !Number.isInteger(object.byteSize) || !Array.isArray(object.roles)) throw new RecoveryRequestError('Backup object manifest is invalid')
    assertSha256(object.digest, 'Backup object digest')
    assertSafeManifestPath(object.relativePath)
    if (object.relativePath !== objectBackupPath(object.digest)) throw new RecoveryRequestError('Backup object path does not match its digest')
  }
  return manifest
}

function parseActivationRequest(content: Buffer): RecoveryActivationRequest {
  if (content.byteLength < 2 || content.byteLength > 8_192) throw new RecoveryRequestError('Recovery activation request size is invalid')
  let parsed: unknown
  try { parsed = JSON.parse(content.toString('utf8')) } catch { throw new RecoveryRequestError('Recovery activation request is malformed') }
  if (!isRecord(parsed) || canonical(parsed) !== content.toString('utf8') || Object.keys(parsed).sort().join(',') !== 'backupId,contractVersion,id,manifestSha256,stagedAt,stateSha256') {
    throw new RecoveryRequestError('Recovery activation request shape is invalid')
  }
  const request = parsed as unknown as RecoveryActivationRequest
  if (request.contractVersion !== ACTIVATION_CONTRACT || !Number.isInteger(request.stagedAt)) throw new RecoveryRequestError('Recovery activation request contract is invalid')
  assertControlledId(request.id, 'Activation id')
  assertControlledId(request.backupId, 'Backup id')
  assertSha256(request.manifestSha256, 'Activation manifest hash')
  assertSha256(request.stateSha256, 'Activation state hash')
  return request
}

function backupSummary(validated: ValidatedBackup, restoreRoot: string): RecoveryValidBackupSummary {
  const { manifest } = validated
  const restorePath = controlledChild(restoreRoot, `restore-${manifest.backupId}`, 'Restore id')
  const restored = existsSync(restorePath) && !lstatSync(restorePath).isSymbolicLink() && lstatSync(restorePath).isDirectory()
  return {
    id: manifest.backupId,
    integrity: 'valid',
    storageKind: validated.storageKind,
    createdAt: manifest.createdAt,
    stateSha256: manifest.source.stateSha256,
    manifestSha256: validated.manifestSha256,
    objectCount: manifest.objects.length,
    derivativeCount: manifest.derivatives.length,
    presentationCount: manifest.presentations.length,
    exportCount: manifest.exports.length,
    manifestUrl: `/api/recovery/backups/${encodeURIComponent(manifest.backupId)}/manifest`,
    archiveUrl: `/api/recovery/backups/${encodeURIComponent(manifest.backupId)}/archive`,
    restored,
  }
}

function invalidBackupSummary(record: BackupStorageRecord): RecoveryInvalidBackupSummary {
  if (record.directoryPath && record.archivePath) return { id: record.id, integrity: 'invalid', storageKind: 'conflict', diagnostic: CONFLICT_DIAGNOSTIC }
  if (record.archivePath) return { id: record.id, integrity: 'invalid', storageKind: 'sealed-zip', diagnostic: INVALID_SEALED_DIAGNOSTIC }
  return { id: record.id, integrity: 'invalid', storageKind: 'legacy-directory', diagnostic: INVALID_LEGACY_DIAGNOSTIC }
}

export class LocalRecoveryService {
  readonly databasePath: string
  readonly contentRoot: string
  readonly backupRoot: string
  readonly restoreRoot: string
  readonly activationRequestPath: string
  readonly rollbackRoot: string

  constructor(options: {
    databasePath: string
    contentRoot: string
    backupRoot: string
    restoreRoot: string
    activationRequestPath?: string
    rollbackRoot?: string
    faults?: RecoveryFaultHooks
  }) {
    this.databasePath = resolve(options.databasePath)
    this.contentRoot = resolve(options.contentRoot)
    this.backupRoot = resolve(options.backupRoot)
    this.restoreRoot = resolve(options.restoreRoot)
    this.activationRequestPath = resolve(options.activationRequestPath ?? join(dirname(this.databasePath), 'recovery-activation.json'))
    this.rollbackRoot = resolve(options.rollbackRoot ?? join(dirname(this.databasePath), 'recovery-rollbacks'))
    this.faults = options.faults ?? {}
  }

  private readonly faults: RecoveryFaultHooks

  inspectCurrent(): RecoveryOverview {
    try {
      const index = inspectDatabase(this.databasePath)
      verifyContentFiles(this.contentRoot, index, true)
      verifyExports(this.databasePath, this.contentRoot, index)
      return {
        stateSha256: index.stateSha256,
        databaseSha256: sha256File(this.databasePath),
        migrationCount: index.migrationLedger.length,
        objectCount: index.objects.length,
        derivativeCount: index.derivatives.length,
        presentationCount: index.presentations.length,
        exportCount: index.exports.length,
        backups: this.listBackups(),
      }
    } catch (error) {
      throw wrapFailure(error, 'Current recovery state inspection failed')
    }
  }

  listBackups(): RecoveryBackupSummary[] {
    const records = this.listBackupStorageRecords()
    const summaries = records.map((record): RecoveryBackupSummary => {
      if (record.directoryPath && record.archivePath) return invalidBackupSummary(record)
      try { return backupSummary(this.validateStorageRecord(record), this.restoreRoot) } catch { return invalidBackupSummary(record) }
    })
    return summaries.sort((left, right) => {
      if (left.integrity !== right.integrity) return left.integrity === 'valid' ? -1 : 1
      if (left.integrity === 'valid' && right.integrity === 'valid') return right.createdAt - left.createdAt || left.id.localeCompare(right.id)
      return left.id.localeCompare(right.id)
    })
  }

  async createBackup(expectedStateSha256: unknown): Promise<RecoveryValidBackupSummary> {
    assertSha256(expectedStateSha256, 'expectedStateSha256')
    const createdAt = Date.now()
    const backupId = `backup-${createdAt}-${randomUUID()}`
    const sourceBeforeHash = sha256File(this.databasePath)
    const sourceBefore = inspectDatabase(this.databasePath)
    verifyContentFiles(this.contentRoot, sourceBefore, true)
    verifyExports(this.databasePath, this.contentRoot, sourceBefore)
    if (sourceBefore.stateSha256 !== expectedStateSha256) throw new RecoveryRequestError('Recovery source state is stale; reload and retry', 409)

    ensureWritableRoot(this.backupRoot, 'Recovery backup root')
    this.assertBackupCapacity(backupId)
    const destination = controlledArchivePath(this.backupRoot, backupId)
    const legacyDestination = controlledChild(this.backupRoot, backupId, 'Backup id')
    if (existsSync(destination) || existsSync(legacyDestination)) throw new RecoveryRequestError('Backup destination already exists')
    const temporary = join(this.backupRoot, `.backup-build-${randomUUID()}.tmp`)
    try {
      mkdirSync(temporary, { mode: 0o700 })
      const snapshotPath = join(temporary, DATABASE_RELATIVE_PATH)
      mkdirSync(dirname(snapshotPath), { recursive: true, mode: 0o700 })
      const sourceDatabase = new Database(this.databasePath, { readonly: true, fileMustExist: true })
      try {
        sourceDatabase.pragma('query_only = ON')
        await sourceDatabase.backup(snapshotPath)
      } finally {
        sourceDatabase.close()
      }
      this.faults.afterDatabaseSnapshot?.()

      const snapshot = inspectIsolatedDatabaseCopy(snapshotPath)
      if (snapshot.stateSha256 !== sourceBefore.stateSha256) throw new RecoveryRequestError('SQLite state changed during backup; retry')
      let copied = 0
      const sourceStore = new LocalContentStore(this.contentRoot)
      for (const object of snapshot.objects) {
        const bytes = sourceStore.read(object.digest)
        writeExclusive(join(temporary, object.relativePath), bytes)
        copied += 1
        this.faults.afterBackupObject?.(copied)
      }

      const sourceAfter = inspectDatabase(this.databasePath)
      verifyContentFiles(this.contentRoot, sourceAfter, true)
      verifyExports(this.databasePath, this.contentRoot, sourceAfter)
      const sourceAfterHash = sha256File(this.databasePath)
      if (sourceAfter.stateSha256 !== sourceBefore.stateSha256 || sourceAfterHash !== sourceBeforeHash) throw new RecoveryRequestError('Recovery source changed during backup; retry')

      const manifest: LocalBackupManifest = {
        contractVersion: BACKUP_CONTRACT,
        backupId,
        createdAt,
        source: { stateSha256: sourceBefore.stateSha256, databaseSha256Before: sourceBeforeHash, databaseSha256After: sourceAfterHash },
        database: {
          relativePath: DATABASE_RELATIVE_PATH,
          sha256: sha256File(snapshotPath),
          byteSize: readFileSync(snapshotPath).byteLength,
          logicalSha256: snapshot.logicalSha256,
          quickCheck: 'ok',
          foreignKeys: true,
          foreignKeyCheckCount: 0,
          migrationLedger: snapshot.migrationLedger,
        },
        objects: snapshot.objects,
        derivatives: snapshot.derivatives,
        presentations: snapshot.presentations,
        exports: snapshot.exports,
      }
      const manifestBytes = Buffer.from(canonical(manifest), 'utf8')
      writeExclusive(join(temporary, MANIFEST_RELATIVE_PATH), manifestBytes)
      this.validateBackupDirectory(temporary, sha256(manifestBytes), backupId, 'sealed-zip')
      const files = listControlledFiles(temporary).map((relativePath) => ({ relativePath, content: readFileSync(join(temporary, relativePath)) }))
      const archive = createStoredZip(files, { maxEntries: MAX_RECOVERY_ARCHIVE_FILES, maxBytes: MAX_RECOVERY_ARCHIVE_BYTES })
      if (archive.byteLength > MAX_RECOVERY_ARCHIVE_BYTES) throw new RecoveryRequestError('Recovery archive exceeds its byte limit', 409)
      this.validateSealedArchiveBytes(archive, sha256(manifestBytes), backupId)
      this.commitSealedArchive(destination, archive, '.backup-write')
      return backupSummary(this.validateBackup(backupId), this.restoreRoot)
    } catch (error) {
      if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true })
      throw wrapFailure(error, 'Local backup creation failed')
    } finally {
      if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true })
    }
  }

  readBackupManifest(backupId: string): { manifest: LocalBackupManifest; manifestSha256: string } {
    const validated = this.validateBackup(backupId)
    return { manifest: validated.manifest, manifestSha256: validated.manifestSha256 }
  }

  readBackupArchive(backupId: string): Buffer {
    const validated = this.validateBackup(backupId)
    try {
      if (validated.storageKind === 'sealed-zip') return Buffer.from(validated.archiveBytes!)
      if (!validated.directory) throw new RecoveryRequestError('Validated legacy backup storage is unavailable')
      const directory = validated.directory
      const files = listControlledFiles(directory).map((relativePath) => ({
        relativePath,
        content: readFileSync(join(directory, relativePath)),
      }))
      const archive = createStoredZip(files, { maxEntries: MAX_RECOVERY_ARCHIVE_FILES, maxBytes: MAX_RECOVERY_ARCHIVE_BYTES })
      if (archive.byteLength > MAX_RECOVERY_ARCHIVE_BYTES) throw new RecoveryRequestError('Recovery archive exceeds its byte limit', 409)
      return archive
    } catch (error) {
      throw wrapFailure(error, 'Recovery archive creation failed')
    }
  }

  importBackupArchive(content: Uint8Array): RecoveryValidBackupSummary {
    const bytes = Buffer.from(content)
    if (bytes.byteLength < 22 || bytes.byteLength > MAX_RECOVERY_ARCHIVE_BYTES) throw new RecoveryRequestError('Recovery archive size is invalid', 400)
    ensureWritableRoot(this.backupRoot, 'Recovery backup root')
    let candidate: ValidatedBackup
    try {
      candidate = this.validateSealedArchiveBytes(bytes)
    } catch (error) {
      throw wrapFailure(error, 'Recovery archive structure is invalid', 400)
    }
    const backupId = candidate.manifest.backupId
    const records = this.listBackupStorageRecords()
    const existingRecord = records.find((record) => record.id === backupId)
    if (existingRecord) {
      if (existingRecord.directoryPath || !existingRecord.archivePath) throw new RecoveryRequestError('Recovery backup id already exists with different storage', 409)
      let existing: ValidatedBackup
      try { existing = this.validateStorageRecord(existingRecord) } catch { throw new RecoveryRequestError('Recovery backup id already exists but is invalid', 409) }
      if (existing.manifestSha256 !== candidate.manifestSha256 || !existing.archiveBytes?.equals(bytes)) {
        throw new RecoveryRequestError('Recovery backup id already exists with different archive bytes', 409)
      }
      return backupSummary(existing, this.restoreRoot)
    }
    this.assertBackupCapacity(backupId, records)
    const destination = controlledArchivePath(this.backupRoot, backupId)
    try {
      this.commitSealedArchive(destination, bytes, '.import-write')
      return backupSummary(this.validateBackup(backupId, candidate.manifestSha256), this.restoreRoot)
    } catch (error) {
      throw wrapFailure(error, 'Recovery archive import failed')
    }
  }

  restoreBackup(backupId: string, expectedManifestSha256: unknown): RecoveryRestoreSummary {
    assertSha256(expectedManifestSha256, 'expectedManifestSha256')
    const validated = this.validateBackup(backupId, expectedManifestSha256)
    ensureWritableRoot(this.restoreRoot, 'Recovery drill root')
    const restoreId = `restore-${backupId}`
    const destination = controlledChild(this.restoreRoot, restoreId, 'Restore id')
    if (existsSync(destination)) throw new RecoveryRequestError('Restore destination already exists; a recovery drill never overwrites')
    const temporary = join(this.restoreRoot, `.restore-${randomUUID()}.tmp`)
    try {
      mkdirSync(temporary, { mode: 0o700 })
      writeExclusive(join(temporary, DATABASE_RELATIVE_PATH), readValidatedBackupFile(validated, DATABASE_RELATIVE_PATH))
      let copied = 0
      for (const object of validated.manifest.objects) {
        writeExclusive(join(temporary, object.relativePath), readValidatedBackupFile(validated, object.relativePath))
        copied += 1
        this.faults.afterRestoreObject?.(copied)
      }
      const databasePath = join(temporary, DATABASE_RELATIVE_PATH)
      const contentRoot = join(temporary, 'objects')
      const restored = inspectIsolatedDatabaseCopy(databasePath, contentRoot)
      if (restored.stateSha256 !== validated.index.stateSha256) throw new RecoveryRequestError('Restored logical state does not match the backup manifest')
      this.revokeAllSessions(databasePath)
      const sessionSafeRestore = inspectIsolatedDatabaseCopy(databasePath, contentRoot)
      this.revokeAllSessions(this.databasePath)
      const summary: RecoveryRestoreSummary = {
        id: restoreId,
        backupId,
        verifiedAt: Date.now(),
        databaseSha256: sha256File(databasePath),
        stateSha256: sessionSafeRestore.stateSha256,
        objectCount: sessionSafeRestore.objects.length,
        derivativeCount: sessionSafeRestore.derivatives.length,
        presentationCount: sessionSafeRestore.presentations.length,
        exportCount: sessionSafeRestore.exports.length,
      }
      writeExclusive(join(temporary, 'restore-report.json'), Buffer.from(canonical({ contractVersion: RESTORE_CONTRACT, ...summary }), 'utf8'))
      renameSync(temporary, destination)
      return summary
    } catch (error) {
      if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true })
      throw wrapFailure(error, 'Isolated restore failed')
    }
  }

  stageActivation(backupId: string, expectedManifestSha256: unknown, confirmation: unknown): RecoveryActivationSummary {
    assertSha256(expectedManifestSha256, 'expectedManifestSha256')
    assertControlledId(backupId, 'Backup id')
    if (confirmation !== `ACTIVATE ${backupId}`) throw new RecoveryRequestError(`Activation confirmation must be exactly ACTIVATE ${backupId}`, 400)
    if (existsSync(this.activationRequestPath)) throw new RecoveryRequestError('A recovery activation is already staged', 409)
    const validated = this.validateBackup(backupId, expectedManifestSha256)
    const restored = this.inspectVerifiedRestore(validated)
    const request: RecoveryActivationRequest = {
      contractVersion: ACTIVATION_CONTRACT,
      id: `activation-${Date.now()}-${randomUUID()}`,
      backupId,
      manifestSha256: validated.manifestSha256,
      stateSha256: restored.stateSha256,
      stagedAt: Date.now(),
    }
    ensureWritableRoot(dirname(this.activationRequestPath), 'Recovery activation root')
    writeExclusive(this.activationRequestPath, Buffer.from(canonical(request), 'utf8'))
    return { id: request.id, backupId, stateSha256: request.stateSha256, stagedAt: request.stagedAt, restartRequired: true }
  }

  applyPendingActivation(): { id: string; backupId: string; stateSha256: string; appliedAt: number } | null {
    if (!existsSync(this.activationRequestPath)) return null
    assertRegularFile(this.activationRequestPath, 'Recovery activation request')
    const request = parseActivationRequest(readFileSync(this.activationRequestPath))
    const validated = this.validateBackup(request.backupId, request.manifestSha256)
    const restored = this.inspectVerifiedRestore(validated)
    if (restored.stateSha256 !== request.stateSha256) throw new RecoveryRequestError('Staged recovery state no longer matches its verified restore')

    ensureWritableRoot(this.rollbackRoot, 'Recovery rollback root')
    const rollbackDirectory = controlledChild(this.rollbackRoot, request.id, 'Activation id')
    const rollbackDatabase = join(rollbackDirectory, 'asset-library.db')
    const finalize = (): { id: string; backupId: string; stateSha256: string; appliedAt: number } => {
      const appliedAt = Date.now()
      const reportPath = join(rollbackDirectory, 'activation-report.json')
      if (!existsSync(reportPath)) writeExclusive(reportPath, Buffer.from(canonical({ contractVersion: ACTIVATION_CONTRACT, id: request.id, backupId: request.backupId, stateSha256: request.stateSha256, appliedAt }), 'utf8'))
      else assertRegularFile(reportPath, 'Recovery activation report')
      const archivedRequest = join(rollbackDirectory, 'activation-request.json')
      if (existsSync(archivedRequest)) throw new RecoveryRequestError('Recovery activation request was already archived')
      renameSync(this.activationRequestPath, archivedRequest)
      return { id: request.id, backupId: request.backupId, stateSha256: request.stateSha256, appliedAt }
    }

    if (existsSync(rollbackDirectory)) {
      if (!existsSync(this.databasePath) && existsSync(rollbackDatabase)) {
        renameSync(rollbackDatabase, this.databasePath)
        for (const suffix of ['-wal', '-shm']) {
          const sidecar = `${rollbackDatabase}${suffix}`
          if (existsSync(sidecar)) renameSync(sidecar, `${this.databasePath}${suffix}`)
        }
        throw new RecoveryRequestError('Interrupted recovery activation was rolled back; review and stage it again')
      }
      if (existsSync(this.databasePath) && inspectIsolatedDatabaseCopy(this.databasePath, this.contentRoot).stateSha256 === request.stateSha256) return finalize()
      throw new RecoveryRequestError('Recovery activation rollback state is ambiguous')
    }

    const targetStore = new LocalContentStore(this.contentRoot)
    for (const object of validated.manifest.objects) {
      const stored = targetStore.put(readFileSync(join(restored.directory, object.relativePath)), object.mediaType)
      if (stored.digest !== object.digest || stored.byteSize !== object.byteSize) throw new RecoveryRequestError('Recovery activation content merge failed')
    }
    const stagedDatabase = join(dirname(this.databasePath), `.recovery-activation-${request.id}.db`)
    if (existsSync(stagedDatabase)) throw new RecoveryRequestError('Recovery activation staging path already exists')
    writeExclusive(stagedDatabase, readFileSync(join(restored.directory, DATABASE_RELATIVE_PATH)))
    if (inspectIsolatedDatabaseCopy(stagedDatabase, this.contentRoot).stateSha256 !== request.stateSha256) {
      unlinkSync(stagedDatabase)
      throw new RecoveryRequestError('Recovery activation staging verification failed')
    }

    mkdirSync(rollbackDirectory, { mode: 0o700 })
    let databaseMoved = false
    try {
      assertRegularFile(this.databasePath, 'Active SQLite database')
      renameSync(this.databasePath, rollbackDatabase)
      databaseMoved = true
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${this.databasePath}${suffix}`
        if (existsSync(sidecar)) {
          assertRegularFile(sidecar, 'Active SQLite sidecar')
          renameSync(sidecar, `${rollbackDatabase}${suffix}`)
        }
      }
      renameSync(stagedDatabase, this.databasePath)
      if (inspectIsolatedDatabaseCopy(this.databasePath, this.contentRoot).stateSha256 !== request.stateSha256) throw new RecoveryRequestError('Activated recovery state verification failed')
      return finalize()
    } catch (error) {
      const failedDatabase = join(rollbackDirectory, 'failed-asset-library.db')
      if (existsSync(this.databasePath) && databaseMoved && !existsSync(failedDatabase)) renameSync(this.databasePath, failedDatabase)
      if (databaseMoved && existsSync(rollbackDatabase) && !existsSync(this.databasePath)) renameSync(rollbackDatabase, this.databasePath)
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${rollbackDatabase}${suffix}`
        if (existsSync(sidecar) && !existsSync(`${this.databasePath}${suffix}`)) renameSync(sidecar, `${this.databasePath}${suffix}`)
      }
      if (existsSync(stagedDatabase)) unlinkSync(stagedDatabase)
      const failedRequest = join(rollbackDirectory, 'failed-activation-request.json')
      if (existsSync(this.activationRequestPath) && !existsSync(failedRequest)) renameSync(this.activationRequestPath, failedRequest)
      throw wrapFailure(error, 'Recovery activation failed and was rolled back')
    }
  }

  private revokeAllSessions(databasePath: string): void {
    const database = new Database(databasePath, { fileMustExist: true })
    try {
      database.pragma('foreign_keys = ON')
      database.exec('BEGIN IMMEDIATE')
      try {
        database.prepare('DELETE FROM sessions').run()
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      if ((database.prepare('SELECT count(*) AS count FROM sessions').get() as { count: number }).count !== 0) throw new RecoveryRequestError('Recovery session revocation failed')
    } finally {
      database.close()
    }
  }

  private inspectVerifiedRestore(validated: ValidatedBackup): { directory: string; stateSha256: string } {
    const directory = controlledChild(this.restoreRoot, `restore-${validated.manifest.backupId}`, 'Restore id')
    assertDirectory(directory, 'Verified restore directory')
    const reportPath = join(directory, 'restore-report.json')
    assertRegularFile(reportPath, 'Restore report')
    let report: unknown
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')) } catch { throw new RecoveryRequestError('Restore report is malformed') }
    if (!isRecord(report) || report.contractVersion !== RESTORE_CONTRACT || report.backupId !== validated.manifest.backupId || typeof report.stateSha256 !== 'string') throw new RecoveryRequestError('Restore report does not match the backup')
    assertSha256(report.stateSha256, 'Restore state hash')
    const expectedFiles = ['restore-report.json', DATABASE_RELATIVE_PATH, ...validated.manifest.objects.map((object) => object.relativePath)].sort()
    if (JSON.stringify(listControlledFiles(directory)) !== JSON.stringify(expectedFiles)) throw new RecoveryRequestError('Verified restore contains a missing or undeclared file')
    const index = inspectIsolatedDatabaseCopy(join(directory, DATABASE_RELATIVE_PATH), join(directory, 'objects'))
    if (index.stateSha256 !== report.stateSha256
      || JSON.stringify(index.objects) !== JSON.stringify(validated.index.objects)
      || JSON.stringify(index.derivatives) !== JSON.stringify(validated.index.derivatives)
      || JSON.stringify(index.presentations) !== JSON.stringify(validated.index.presentations)
      || JSON.stringify(index.exports) !== JSON.stringify(validated.index.exports)) throw new RecoveryRequestError('Verified restore no longer matches its backup')
    if (index.sessionCount !== 0) throw new RecoveryRequestError('Verified restore still contains active sessions')
    return { directory, stateSha256: index.stateSha256 }
  }

  private validateBackup(backupId: string, expectedManifestSha256?: string): ValidatedBackup {
    assertControlledId(backupId, 'Backup id')
    const record = this.listBackupStorageRecords().find((candidate) => candidate.id === backupId)
    if (!record) throw new RecoveryRequestError('Recovery backup was not found', 404)
    if (record.directoryPath && record.archivePath) throw new RecoveryRequestError(CONFLICT_DIAGNOSTIC, 409)
    try {
      return this.validateStorageRecord(record, expectedManifestSha256)
    } catch (error) {
      if (error instanceof RecoveryRequestError && (error.status === 400 || error.status === 404 || error.status === 500)) throw error
      throw new RecoveryRequestError('Recovery backup is invalid or tampered and cannot be used', 409)
    }
  }

  private listBackupStorageRecords(): BackupStorageRecord[] {
    if (!existsSync(this.backupRoot)) return []
    assertDirectory(this.backupRoot, 'Recovery backup root')
    const records = new Map<string, { id: string; directoryPath?: string; archivePath?: string }>()
    for (const entry of readdirSync(this.backupRoot, { withFileTypes: true })) {
      let id: string | undefined
      let kind: 'directoryPath' | 'archivePath' | undefined
      if (/^backup-[a-z0-9-]+$/.test(entry.name)) {
        id = entry.name
        kind = 'directoryPath'
      } else if (/^backup-[a-z0-9-]+\.zip$/.test(entry.name)) {
        id = entry.name.slice(0, -SEALED_BACKUP_SUFFIX.length)
        kind = 'archivePath'
      }
      if (!id || !kind) continue
      assertControlledId(id, 'Backup id')
      const record = records.get(id) ?? { id }
      record[kind] = kind === 'directoryPath'
        ? controlledChild(this.backupRoot, id, 'Backup id')
        : controlledArchivePath(this.backupRoot, id)
      records.set(id, record)
    }
    if (records.size > MAX_BACKUPS) throw new RecoveryRequestError(`Recovery UI is limited to ${MAX_BACKUPS} local backups`)
    return [...records.values()].sort((left, right) => left.id.localeCompare(right.id))
  }

  private assertBackupCapacity(backupId: string, records = this.listBackupStorageRecords()): void {
    if (!records.some((record) => record.id === backupId) && records.length >= MAX_BACKUPS) {
      throw new RecoveryRequestError(`Recovery UI is limited to ${MAX_BACKUPS} local backups`)
    }
  }

  private validateStorageRecord(record: BackupStorageRecord, expectedManifestSha256?: string): ValidatedBackup {
    if (record.directoryPath && record.archivePath) throw new RecoveryRequestError(CONFLICT_DIAGNOSTIC, 409)
    if (record.archivePath) return this.validateSealedArchivePath(record.archivePath, expectedManifestSha256, record.id)
    if (record.directoryPath) return this.validateBackupDirectory(record.directoryPath, expectedManifestSha256, record.id, 'legacy-directory')
    throw new RecoveryRequestError('Recovery backup was not found', 404)
  }

  private validateSealedArchivePath(archivePath: string, expectedManifestSha256?: string, expectedBackupId?: string): ValidatedBackup {
    assertRegularFile(archivePath, 'Sealed backup archive')
    return this.validateSealedArchiveBytes(readFileSync(archivePath), expectedManifestSha256, expectedBackupId)
  }

  private validateSealedArchiveBytes(content: Buffer, expectedManifestSha256?: string, expectedBackupId?: string): ValidatedBackup {
    if (content.byteLength < 22 || content.byteLength > MAX_RECOVERY_ARCHIVE_BYTES) throw new RecoveryRequestError('Recovery archive size is invalid')
    let files: Map<string, Buffer>
    try { files = readStoredZip(content, { maxEntries: MAX_RECOVERY_ARCHIVE_FILES, maxBytes: MAX_RECOVERY_ARCHIVE_BYTES }) }
    catch (error) { throw wrapFailure(error, 'Recovery archive structure is invalid') }
    const manifestBytes = files.get(MANIFEST_RELATIVE_PATH)
    if (!manifestBytes) throw new RecoveryRequestError('Recovery archive manifest is missing')
    const manifest = parseManifest(manifestBytes)
    const manifestSha256 = sha256(manifestBytes)
    if (expectedManifestSha256 && manifestSha256 !== expectedManifestSha256) throw new RecoveryRequestError('Backup manifest hash is stale or tampered')
    if (expectedBackupId && manifest.backupId !== expectedBackupId) throw new RecoveryRequestError('Backup manifest id does not match its controlled archive')
    const expectedFiles = [MANIFEST_RELATIVE_PATH, DATABASE_RELATIVE_PATH, ...manifest.objects.map((object) => object.relativePath)].sort()
    if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify(expectedFiles)) throw new RecoveryRequestError('Recovery archive contains a missing or undeclared file')

    const validationRoot = mkdtempSync(join(tmpdir(), 'asset-library-sealed-backup-'))
    try {
      for (const relativePath of expectedFiles) writeExclusive(join(validationRoot, relativePath), files.get(relativePath)!)
      const validated = this.validateBackupDirectory(validationRoot, manifestSha256, manifest.backupId, 'sealed-zip')
      return { ...validated, directory: undefined, files, archiveBytes: Buffer.from(content) }
    } finally {
      rmSync(validationRoot, { recursive: true, force: true })
    }
  }

  private commitSealedArchive(destination: string, content: Buffer, temporaryPrefix: string): void {
    const lockPath = `${destination}.lock`
    const temporary = join(this.backupRoot, `${temporaryPrefix}-${randomUUID()}.tmp`)
    let lockDescriptor: number | undefined
    try {
      try { lockDescriptor = openSync(lockPath, 'wx', 0o600) }
      catch { throw new RecoveryRequestError('Backup destination is locked or already being committed') }
      if (existsSync(destination)) throw new RecoveryRequestError('Backup destination already exists')
      writeExclusive(temporary, content)
      this.faults.beforeArchiveCommit?.()
      if (existsSync(destination)) throw new RecoveryRequestError('Backup destination already exists')
      renameSync(temporary, destination)
      fsyncDirectory(this.backupRoot)
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary)
      throw error
    } finally {
      if (lockDescriptor !== undefined) {
        closeSync(lockDescriptor)
        if (existsSync(lockPath)) unlinkSync(lockPath)
      }
    }
  }

  private validateBackupDirectory(directory: string, expectedManifestSha256?: string, expectedBackupId?: string, storageKind: RecoveryBackupStorageKind = 'legacy-directory'): ValidatedBackup {
    try {
      assertDirectory(directory, 'Backup directory')
      const manifestPath = join(directory, MANIFEST_RELATIVE_PATH)
      assertRegularFile(manifestPath, 'Backup manifest')
      const manifestBytes = readFileSync(manifestPath)
      const manifestSha256 = sha256(manifestBytes)
      if (expectedManifestSha256 && manifestSha256 !== expectedManifestSha256) throw new RecoveryRequestError('Backup manifest hash is stale or tampered')
      const manifest = parseManifest(manifestBytes)
      if (expectedBackupId && manifest.backupId !== expectedBackupId) throw new RecoveryRequestError('Backup manifest id does not match its controlled directory')
      const expectedFiles = [MANIFEST_RELATIVE_PATH, DATABASE_RELATIVE_PATH, ...manifest.objects.map((object) => object.relativePath)].sort()
      if (JSON.stringify(listControlledFiles(directory)) !== JSON.stringify(expectedFiles)) throw new RecoveryRequestError('Backup contains a missing or undeclared file')

      const databasePath = join(directory, DATABASE_RELATIVE_PATH)
      assertRegularFile(databasePath, 'Backup SQLite database')
      const databaseBytes = readFileSync(databasePath)
      if (databaseBytes.byteLength !== manifest.database.byteSize || sha256(databaseBytes) !== manifest.database.sha256) throw new RecoveryRequestError('Backup SQLite hash or size verification failed')
      for (const object of manifest.objects) {
        const path = join(directory, object.relativePath)
        assertRegularFile(path, 'Backup content object')
        const bytes = readFileSync(path)
        if (bytes.byteLength !== object.byteSize || sha256(bytes) !== object.digest) throw new RecoveryRequestError('Backup content object hash or size verification failed')
      }

      const index = inspectIsolatedDatabaseCopy(databasePath, join(directory, 'objects'))
      if (manifest.source.stateSha256 !== index.stateSha256
        || manifest.database.logicalSha256 !== index.logicalSha256
        || JSON.stringify(manifest.database.migrationLedger) !== JSON.stringify(index.migrationLedger)
        || JSON.stringify(manifest.objects) !== JSON.stringify(index.objects)
        || JSON.stringify(manifest.derivatives) !== JSON.stringify(index.derivatives)
        || JSON.stringify(manifest.presentations) !== JSON.stringify(index.presentations)
        || JSON.stringify(manifest.exports) !== JSON.stringify(index.exports)) throw new RecoveryRequestError('Backup manifest does not match the restored database index')
      return { storageKind, directory, manifest, manifestSha256, index }
    } catch (error) {
      throw wrapFailure(error, 'Backup validation failed')
    }
  }
}
