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

const BACKUP_CONTRACT = 'asset-library-local-backup/v1' as const
const RESTORE_CONTRACT = 'asset-library-local-restore/v1' as const
const SHA256 = /^[0-9a-f]{64}$/
const CONTROLLED_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_OBJECTS = 5_000
const MAX_DERIVATIVES = 10_000
const MAX_PRESENTATIONS = 1_000
const MAX_ITEMS = 10_000
const MAX_EXPORTS = 1_000
const MAX_BACKUPS = 20
const DATABASE_RELATIVE_PATH = 'database/asset-library.db' as const
const MANIFEST_RELATIVE_PATH = 'backup-manifest.json' as const

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

export type RecoveryBackupSummary = Readonly<{
  id: string
  createdAt: number
  stateSha256: string
  manifestSha256: string
  objectCount: number
  derivativeCount: number
  presentationCount: number
  exportCount: number
  manifestUrl: string
  restored: boolean
}>

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
  afterRestoreObject?: (copiedCount: number) => void
}>

type DatabaseIndex = Readonly<{
  logicalSha256: string
  stateSha256: string
  migrationLedger: MigrationLedgerEntry[]
  objects: BackupObjectEntry[]
  derivatives: BackupDerivativeEntry[]
  presentations: BackupPresentationEntry[]
  exports: BackupExportEntry[]
}>

type ValidatedBackup = Readonly<{
  directory: string
  manifest: LocalBackupManifest
  manifestSha256: string
  index: DatabaseIndex
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
    const stateSha256 = sha256(JSON.stringify({ logicalSha256, migrationLedger, objects, derivatives, presentations, exports }))
    return { logicalSha256, stateSha256, migrationLedger, objects, derivatives, presentations, exports }
  } catch (error) {
    throw wrapFailure(error, 'SQLite recovery preflight failed')
  } finally {
    database.close()
  }
}

function verifyContentFiles(contentRoot: string, index: DatabaseIndex): void {
  if (index.objects.length === 0) return
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

function backupSummary(validated: ValidatedBackup, restoreRoot: string): RecoveryBackupSummary {
  const { manifest } = validated
  return {
    id: manifest.backupId,
    createdAt: manifest.createdAt,
    stateSha256: manifest.source.stateSha256,
    manifestSha256: validated.manifestSha256,
    objectCount: manifest.objects.length,
    derivativeCount: manifest.derivatives.length,
    presentationCount: manifest.presentations.length,
    exportCount: manifest.exports.length,
    manifestUrl: `/api/recovery/backups/${encodeURIComponent(manifest.backupId)}/manifest`,
    restored: existsSync(controlledChild(restoreRoot, `restore-${manifest.backupId}`, 'Restore id')),
  }
}

export class LocalRecoveryService {
  readonly databasePath: string
  readonly contentRoot: string
  readonly backupRoot: string
  readonly restoreRoot: string

  constructor(options: {
    databasePath: string
    contentRoot: string
    backupRoot: string
    restoreRoot: string
    faults?: RecoveryFaultHooks
  }) {
    this.databasePath = resolve(options.databasePath)
    this.contentRoot = resolve(options.contentRoot)
    this.backupRoot = resolve(options.backupRoot)
    this.restoreRoot = resolve(options.restoreRoot)
    this.faults = options.faults ?? {}
  }

  private readonly faults: RecoveryFaultHooks

  inspectCurrent(): RecoveryOverview {
    try {
      const index = inspectDatabase(this.databasePath)
      verifyContentFiles(this.contentRoot, index)
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
    if (!existsSync(this.backupRoot)) return []
    assertDirectory(this.backupRoot, 'Recovery backup root')
    const ids = readdirSync(this.backupRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && /^backup-[a-z0-9-]+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
    if (ids.length > MAX_BACKUPS) throw new RecoveryRequestError(`Recovery UI is limited to ${MAX_BACKUPS} local backups`)
    return ids.map((id) => backupSummary(this.validateBackup(id), this.restoreRoot)).sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
  }

  async createBackup(expectedStateSha256: unknown): Promise<RecoveryBackupSummary> {
    assertSha256(expectedStateSha256, 'expectedStateSha256')
    const createdAt = Date.now()
    const backupId = `backup-${createdAt}-${randomUUID()}`
    const sourceBeforeHash = sha256File(this.databasePath)
    const sourceBefore = inspectDatabase(this.databasePath)
    verifyContentFiles(this.contentRoot, sourceBefore)
    verifyExports(this.databasePath, this.contentRoot, sourceBefore)
    if (sourceBefore.stateSha256 !== expectedStateSha256) throw new RecoveryRequestError('Recovery source state is stale; reload and retry', 409)

    ensureWritableRoot(this.backupRoot, 'Recovery backup root')
    const destination = controlledChild(this.backupRoot, backupId, 'Backup id')
    if (existsSync(destination)) throw new RecoveryRequestError('Backup destination already exists')
    const temporary = join(this.backupRoot, `.backup-${randomUUID()}.tmp`)
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
      verifyContentFiles(this.contentRoot, sourceAfter)
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
      this.validateBackupDirectory(temporary, sha256(manifestBytes), backupId)
      renameSync(temporary, destination)
      return backupSummary(this.validateBackup(backupId), this.restoreRoot)
    } catch (error) {
      if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true })
      throw wrapFailure(error, 'Local backup creation failed')
    }
  }

  readBackupManifest(backupId: string): { manifest: LocalBackupManifest; manifestSha256: string } {
    const validated = this.validateBackup(backupId)
    return { manifest: validated.manifest, manifestSha256: validated.manifestSha256 }
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
      writeExclusive(join(temporary, DATABASE_RELATIVE_PATH), readFileSync(join(validated.directory, DATABASE_RELATIVE_PATH)))
      let copied = 0
      for (const object of validated.manifest.objects) {
        writeExclusive(join(temporary, object.relativePath), readFileSync(join(validated.directory, object.relativePath)))
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

  private validateBackup(backupId: string, expectedManifestSha256?: string): ValidatedBackup {
    assertControlledId(backupId, 'Backup id')
    const directory = controlledChild(this.backupRoot, backupId, 'Backup id')
    return this.validateBackupDirectory(directory, expectedManifestSha256, backupId)
  }

  private validateBackupDirectory(directory: string, expectedManifestSha256?: string, expectedBackupId?: string): ValidatedBackup {
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
      return { directory, manifest, manifestSha256, index }
    } catch (error) {
      throw wrapFailure(error, 'Backup validation failed')
    }
  }
}
