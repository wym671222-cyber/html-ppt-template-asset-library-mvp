import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import JSZip, { type JSZipObject } from 'jszip'
import {
  assertValidTemplatePackage,
  INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION,
  TEMPLATE_PACKAGE_CONTRACT_VERSION,
  type TemplatePackageSource,
} from '@slide-maker/shared'
import { AuditEventWriter } from '../auth/audit.js'
import { assertSafeInteractiveTemplatePackage } from '../templates/interactive-template-policy.js'
import { isAllowlistedInteractiveTemplateDigest } from '../templates/interactive-template-allowlist.js'
import { serializeTemplatePackage } from '../templates/simulated-adapter.js'
import { assertSafePreviewPackage } from '../previews/secure-preview.js'
import { LocalContentStore } from './content-store.js'

type Database = BetterSqlite3.Database

const CONTRACT = 'asset-library-catalog-transfer/v1' as const
const MANIFEST_PATH = 'catalog-transfer-manifest.json'
const SHA256 = /^[0-9a-f]{64}$/
const RELEASE_SHA = /^[0-9a-f]{40}$/
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SAFE_RENDERER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
export const MAX_CATALOG_TRANSFER_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024
const MAX_ENTRIES = 10_000
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024
const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z')
const PROTECTED_TABLES = ['users', 'sessions', 'auth_throttle', 'presentations', 'presentation_items', 'presentation_exports'] as const
const DERIVATIVE_DELETE_TRIGGER = 'template_preview_derivatives_append_only_delete'

type ContentRow = { digest: string; mediaType: string; byteSize: number; relativePath: string; createdAt: number }
type Asset = {
  id: string
  title: string
  summary: string
  category: string
  status: 'active'
  currentVersionId: string
  createdAt: number
  updatedAt: number
  tagIds: string[]
}
type Version = {
  id: string
  assetId: string
  versionNumber: number
  contractVersion: string
  sourceDigest: string
  contentObjectDigest: string
  slotSchema: unknown
  status: string
  createdAt: number
}
type Tag = { id: string; label: string; createdAt: number }
type Derivative = {
  templateVersionId: string
  kind: 'preview' | 'thumbnail'
  sourceDigest: string
  contentDigest: string
  rendererVersion: string
  securityDiagnostic: unknown
  createdAt: number
}
type TransferFile = { path: string; sha256: string; byteSize: number; mediaType: string }
type CatalogSnapshot = { assets: Asset[]; versions: Version[]; tags: Tag[]; derivatives: Derivative[]; objects: ContentRow[] }
type Manifest = CatalogSnapshot & {
  contractVersion: typeof CONTRACT
  sourceReleaseSha: string
  sourceCatalogStateSha256: string
  files: TransferFile[]
  counts: { assets: number; versions: number; tags: number; derivatives: number; objects: number; files: number }
}

export type CatalogTransferDiff = Readonly<{ activate: string[]; update: string[]; reuse: string[]; retire: string[] }>
export type CatalogTransferValidation = Readonly<{
  transferId: string
  manifestSha256: string
  sourceCatalogStateSha256: string
  targetCatalogStateSha256: string
  diff: CatalogTransferDiff
}>

export class CatalogTransferError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503 = 400) {
    super(message)
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) =>
        `${JSON.stringify(key)}:${canonical(item)}`
      ).join(',')
    }}`
  }
  return JSON.stringify(value)
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
    throw new CatalogTransferError(`${label} contains missing or unknown fields`)
  }
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogTransferError(`${label} must be one object`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max = 500): string {
  if (
    typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value) ||
    value !== value.normalize('NFC')
  ) throw new CatalogTransferError(`${label} is invalid`)
  return value
}
function optionalText(value: unknown, label: string, max: number): string {
  if (value === '') return ''
  return text(value, label, max)
}
function securityDiagnostic(value: unknown): Record<string, boolean | number> {
  const diagnostic = record(value, 'security diagnostic')
  if (Object.keys(diagnostic).length > 32) throw new CatalogTransferError('security diagnostic is invalid')
  for (const [key, item] of Object.entries(diagnostic)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key) || (typeof item !== 'boolean' && (!Number.isSafeInteger(item) || Number(item) < 0))) {
      throw new CatalogTransferError('security diagnostic is invalid')
    }
  }
  return diagnostic as Record<string, boolean | number>
}
function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new CatalogTransferError(`${label} is invalid`)
  return Number(value)
}
function unique<T>(values: readonly T[], label: string): void {
  if (new Set(values).size !== values.length) throw new CatalogTransferError(`Catalog transfer contains duplicate ${label}`)
}
function objectPath(digest: string): string {
  return `objects/sha256/${digest.slice(0, 2)}/${digest}`
}
function storePath(digest: string): string {
  return `sha256/${digest.slice(0, 2)}/${digest}`
}

function rows(database: Database, sql: string, ...parameters: unknown[]): Record<string, unknown>[] {
  return database.prepare(sql).all(...parameters) as Record<string, unknown>[]
}

export type CatalogTransferProtectedState = Readonly<{
  sha256: string
  tables: Readonly<Record<(typeof PROTECTED_TABLES)[number], Readonly<{ count: number; sha256: string }>>>
}>

function protectedState(database: Database): CatalogTransferProtectedState {
  const snapshots = Object.fromEntries(
    PROTECTED_TABLES.map((table) => [table, rows(database, `SELECT * FROM ${table} ORDER BY 1`)]),
  ) as Record<(typeof PROTECTED_TABLES)[number], Record<string, unknown>[]>
  const tables = Object.fromEntries(PROTECTED_TABLES.map((table) => [table, {
    count: snapshots[table].length,
    sha256: sha256(canonical(snapshots[table])),
  }])) as Record<(typeof PROTECTED_TABLES)[number], { count: number; sha256: string }>
  return { sha256: sha256(canonical(snapshots)), tables }
}

function targetCatalogState(database: Database): string {
  const snapshot = {
    assets: rows(
      database,
      'SELECT id, title, summary, category, status, current_version_id, created_at, updated_at FROM template_assets ORDER BY id',
    ),
    versions: rows(
      database,
      'SELECT id, asset_id, version_number, contract_version, source_digest, content_object_digest, slot_schema, status, created_at FROM template_versions ORDER BY id',
    ),
    tags: rows(database, 'SELECT id, label, created_at FROM tags ORDER BY id'),
    assetTags: rows(database, 'SELECT asset_id, tag_id FROM template_asset_tags ORDER BY asset_id, tag_id'),
    derivatives: rows(
      database,
      'SELECT template_version_id, kind, source_digest, content_digest, renderer_version, security_diagnostic, created_at FROM template_preview_derivatives ORDER BY template_version_id, kind, source_digest, renderer_version',
    ),
    objects: rows(database, 'SELECT digest, media_type, byte_size, relative_path, created_at FROM content_objects ORDER BY digest'),
  }
  return sha256(canonical(snapshot))
}

function sourceSnapshot(database: Database): CatalogSnapshot {
  const assetRows = rows(
    database,
    "SELECT id, title, summary, category, current_version_id, created_at, updated_at FROM template_assets WHERE status = 'active' ORDER BY id",
  )
  const assetIds = assetRows.map((row) => String(row.id))
  const assets: Asset[] = assetRows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    summary: String(row.summary),
    category: String(row.category),
    status: 'active',
    currentVersionId: String(row.current_version_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    tagIds:
      (database.prepare('SELECT tag_id FROM template_asset_tags WHERE asset_id = ? ORDER BY tag_id').all(row.id) as { tag_id: string }[])
        .map((tag) => tag.tag_id),
  }))
  const versions = assetIds.flatMap((assetId) =>
    rows(
      database,
      'SELECT id, asset_id, version_number, contract_version, source_digest, content_object_digest, slot_schema, status, created_at FROM template_versions WHERE asset_id = ? ORDER BY version_number, id',
      assetId,
    ).map((row) => ({
      id: String(row.id),
      assetId: String(row.asset_id),
      versionNumber: Number(row.version_number),
      contractVersion: String(row.contract_version),
      sourceDigest: String(row.source_digest),
      contentObjectDigest: String(row.content_object_digest),
      slotSchema: JSON.parse(String(row.slot_schema)) as unknown,
      status: String(row.status),
      createdAt: Number(row.created_at),
    }))
  )
  const versionIds = new Set(versions.map((version) => version.id))
  const derivatives = rows(
    database,
    'SELECT template_version_id, kind, source_digest, content_digest, renderer_version, security_diagnostic, created_at FROM template_preview_derivatives ORDER BY template_version_id, kind, source_digest, renderer_version',
  )
    .filter((row) => versionIds.has(String(row.template_version_id)))
    .map((row) => ({
      templateVersionId: String(row.template_version_id),
      kind: String(row.kind) as 'preview' | 'thumbnail',
      sourceDigest: String(row.source_digest),
      contentDigest: String(row.content_digest),
      rendererVersion: String(row.renderer_version),
      securityDiagnostic: JSON.parse(String(row.security_diagnostic)) as unknown,
      createdAt: Number(row.created_at),
    }))
  const tagIds = new Set(assets.flatMap((asset) => asset.tagIds))
  const tags = rows(database, 'SELECT id, label, created_at FROM tags ORDER BY id').filter((row) => tagIds.has(String(row.id))).map((
    row,
  ) => ({ id: String(row.id), label: String(row.label), createdAt: Number(row.created_at) }))
  const digests = new Set([
    ...versions.map((version) => version.contentObjectDigest),
    ...derivatives.map((derivative) => derivative.contentDigest),
  ])
  const objects = rows(database, 'SELECT digest, media_type, byte_size, relative_path, created_at FROM content_objects ORDER BY digest')
    .filter((row) => digests.has(String(row.digest))).map((row) => ({
      digest: String(row.digest),
      mediaType: String(row.media_type),
      byteSize: Number(row.byte_size),
      relativePath: String(row.relative_path),
      createdAt: Number(row.created_at),
    }))
  return { assets, versions, tags, derivatives, objects }
}

function entrySize(entry: JSZipObject): number {
  const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
  if (!Number.isSafeInteger(size) || Number(size) < 0) throw new CatalogTransferError('Catalog transfer ZIP entry size is invalid')
  return Number(size)
}

function centralDirectoryNames(content: Buffer): string[] {
  let end = -1
  for (let offset = content.length - 22; offset >= Math.max(0, content.length - 65_557); offset -= 1) {
    if (content.readUInt32LE(offset) === 0x06054b50) {
      end = offset
      break
    }
  }
  if (end < 0) throw new CatalogTransferError('Catalog transfer ZIP end record is invalid')
  const count = content.readUInt16LE(end + 10)
  const size = content.readUInt32LE(end + 12)
  let offset = content.readUInt32LE(end + 16)
  if (count < 1 || count > MAX_ENTRIES || offset + size !== end) {
    throw new CatalogTransferError('Catalog transfer ZIP central directory is invalid')
  }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const names: string[] = []
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || content.readUInt32LE(offset) !== 0x02014b50) {
      throw new CatalogTransferError('Catalog transfer ZIP central entry is invalid')
    }
    const flags = content.readUInt16LE(offset + 8)
    // The package contract permits ASCII names only, so the optional UTF-8 flag
    // is not required. Encryption is always rejected.
    if ((flags & 0x1) !== 0) throw new CatalogTransferError('Catalog transfer ZIP entries must be unencrypted')
    const nameLength = content.readUInt16LE(offset + 28)
    const extraLength = content.readUInt16LE(offset + 30)
    const commentLength = content.readUInt16LE(offset + 32)
    try {
      names.push(decoder.decode(content.subarray(offset + 46, offset + 46 + nameLength)))
    } catch {
      throw new CatalogTransferError('Catalog transfer ZIP entry name is not UTF-8')
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (offset !== end) throw new CatalogTransferError('Catalog transfer ZIP central directory size is invalid')
  unique(names, 'ZIP entry')
  return names
}

function safePath(name: string): void {
  if (
    !name || name.startsWith('/') || name.includes('\\') || name.includes(':') || name.endsWith('/') || name.split('/').includes('..') ||
    (name !== MANIFEST_PATH && !/^objects\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(name))
  ) throw new CatalogTransferError('Catalog transfer ZIP contains an unsafe path')
}

function parseManifest(value: unknown): Manifest {
  const root = record(value, 'Catalog transfer manifest')
  exactKeys(root, [
    'contractVersion',
    'sourceReleaseSha',
    'sourceCatalogStateSha256',
    'assets',
    'versions',
    'tags',
    'derivatives',
    'objects',
    'files',
    'counts',
  ], 'Catalog transfer manifest')
  if (
    root.contractVersion !== CONTRACT || typeof root.sourceReleaseSha !== 'string' || !RELEASE_SHA.test(root.sourceReleaseSha) ||
    typeof root.sourceCatalogStateSha256 !== 'string' || !SHA256.test(root.sourceCatalogStateSha256)
  ) throw new CatalogTransferError('Catalog transfer manifest identity is invalid')
  for (const key of ['assets', 'versions', 'tags', 'derivatives', 'objects', 'files'] as const) {
    if (!Array.isArray(root[key])) throw new CatalogTransferError(`Catalog transfer manifest ${key} must be an array`)
  }
  const arrays = root as Record<'assets' | 'versions' | 'tags' | 'derivatives' | 'objects' | 'files', unknown[]>
  const assets = arrays.assets.map((item, index) => {
    const row = record(item, `asset ${index}`)
    exactKeys(
      row,
      ['id', 'title', 'summary', 'category', 'status', 'currentVersionId', 'createdAt', 'updatedAt', 'tagIds'],
      `asset ${index}`,
    )
    if (
      typeof row.id !== 'string' || !SAFE_ID.test(row.id) || row.status !== 'active' || typeof row.currentVersionId !== 'string' ||
      !SAFE_ID.test(row.currentVersionId) || !Array.isArray(row.tagIds) || row.tagIds.some((id) =>
        typeof id !== 'string' || !SAFE_ID.test(id)
      )
    ) throw new CatalogTransferError(`asset ${index} is invalid`)
    unique(row.tagIds as string[], 'asset tag id')
    return {
      id: row.id,
      title: text(row.title, 'asset title', 120),
      summary: optionalText(row.summary, 'asset summary', 1_000),
      category: text(row.category, 'asset category', 80),
      status: 'active' as const,
      currentVersionId: row.currentVersionId,
      createdAt: integer(row.createdAt, 'asset createdAt'),
      updatedAt: integer(row.updatedAt, 'asset updatedAt'),
      tagIds: row.tagIds as string[],
    }
  })
  const versions = arrays.versions.map((item, index) => {
    const row = record(item, `version ${index}`)
    exactKeys(row, [
      'id',
      'assetId',
      'versionNumber',
      'contractVersion',
      'sourceDigest',
      'contentObjectDigest',
      'slotSchema',
      'status',
      'createdAt',
    ], `version ${index}`)
    if (
      typeof row.id !== 'string' || !SAFE_ID.test(row.id) || typeof row.assetId !== 'string' || !SAFE_ID.test(row.assetId) ||
      !Number.isSafeInteger(row.versionNumber) || Number(row.versionNumber) < 1 ||
      ![TEMPLATE_PACKAGE_CONTRACT_VERSION, INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION].includes(row.contractVersion as never) ||
      typeof row.sourceDigest !== 'string' || !SHA256.test(row.sourceDigest) || row.contentObjectDigest !== row.sourceDigest ||
      !['draft', 'verified', 'available', 'unavailable'].includes(String(row.status))
    ) throw new CatalogTransferError(`version ${index} is invalid`)
    return {
      id: row.id,
      assetId: row.assetId,
      versionNumber: Number(row.versionNumber),
      contractVersion: String(row.contractVersion),
      sourceDigest: row.sourceDigest,
      contentObjectDigest: row.contentObjectDigest,
      slotSchema: record(row.slotSchema, 'slot schema'),
      status: String(row.status),
      createdAt: integer(row.createdAt, 'version createdAt'),
    }
  })
  const tags = arrays.tags.map((item, index) => {
    const row = record(item, `tag ${index}`)
    exactKeys(row, ['id', 'label', 'createdAt'], `tag ${index}`)
    if (typeof row.id !== 'string' || !SAFE_ID.test(row.id)) throw new CatalogTransferError(`tag ${index} is invalid`)
    return { id: row.id, label: text(row.label, 'tag label', 40), createdAt: integer(row.createdAt, 'tag createdAt') }
  })
  const derivatives = arrays.derivatives.map((item, index) => {
    const row = record(item, `derivative ${index}`)
    exactKeys(
      row,
      ['templateVersionId', 'kind', 'sourceDigest', 'contentDigest', 'rendererVersion', 'securityDiagnostic', 'createdAt'],
      `derivative ${index}`,
    )
    if (
      typeof row.templateVersionId !== 'string' || !SAFE_ID.test(row.templateVersionId) ||
      (row.kind !== 'preview' && row.kind !== 'thumbnail') || typeof row.sourceDigest !== 'string' || !SHA256.test(row.sourceDigest) ||
      typeof row.contentDigest !== 'string' || !SHA256.test(row.contentDigest) || typeof row.rendererVersion !== 'string' ||
      !SAFE_RENDERER.test(row.rendererVersion)
    ) throw new CatalogTransferError(`derivative ${index} renderer or identity is invalid`)
    return {
      templateVersionId: row.templateVersionId,
      kind: row.kind as 'preview' | 'thumbnail',
      sourceDigest: row.sourceDigest,
      contentDigest: row.contentDigest,
      rendererVersion: row.rendererVersion,
      securityDiagnostic: securityDiagnostic(row.securityDiagnostic),
      createdAt: integer(row.createdAt, 'derivative createdAt'),
    }
  })
  const objects = arrays.objects.map((item, index) => {
    const row = record(item, `object ${index}`)
    exactKeys(row, ['digest', 'mediaType', 'byteSize', 'relativePath', 'createdAt'], `object ${index}`)
    if (
      typeof row.digest !== 'string' || !SHA256.test(row.digest) || typeof row.mediaType !== 'string' ||
      !/^(?:application\/vnd\.html-template-package\+json|image\/png)$/.test(row.mediaType) || row.relativePath !== storePath(row.digest)
    ) throw new CatalogTransferError(`object ${index} is invalid`)
    return {
      digest: row.digest,
      mediaType: row.mediaType,
      byteSize: integer(row.byteSize, 'object byteSize'),
      relativePath: row.relativePath,
      createdAt: integer(row.createdAt, 'object createdAt'),
    }
  })
  const files = arrays.files.map((item, index) => {
    const row = record(item, `file ${index}`)
    exactKeys(row, ['path', 'sha256', 'byteSize', 'mediaType'], `file ${index}`)
    if (
      typeof row.path !== 'string' || typeof row.sha256 !== 'string' || !SHA256.test(row.sha256) || row.path !== objectPath(row.sha256) ||
      typeof row.mediaType !== 'string'
    ) throw new CatalogTransferError(`file ${index} path or digest is invalid`)
    return { path: row.path, sha256: row.sha256, byteSize: integer(row.byteSize, 'file byteSize'), mediaType: row.mediaType }
  })
  const counts = record(root.counts, 'counts')
  exactKeys(counts, ['assets', 'versions', 'tags', 'derivatives', 'objects', 'files'], 'counts')
  const parsed: Manifest = {
    contractVersion: CONTRACT,
    sourceReleaseSha: root.sourceReleaseSha,
    sourceCatalogStateSha256: root.sourceCatalogStateSha256,
    assets,
    versions,
    tags,
    derivatives,
    objects,
    files,
    counts: {
      assets: integer(counts.assets, 'asset count'),
      versions: integer(counts.versions, 'version count'),
      tags: integer(counts.tags, 'tag count'),
      derivatives: integer(counts.derivatives, 'derivative count'),
      objects: integer(counts.objects, 'object count'),
      files: integer(counts.files, 'file count'),
    },
  }
  unique(assets.map((row) => row.id), 'asset id')
  unique(versions.map((row) => row.id), 'version id')
  unique(tags.map((row) => row.id), 'tag id')
  unique(tags.map((row) => row.label), 'tag label')
  unique(objects.map((row) => row.digest), 'object digest')
  unique(files.map((row) => row.path), 'file path')
  unique(
    derivatives.map((row) => `${row.templateVersionId}\0${row.kind}\0${row.sourceDigest}\0${row.rendererVersion}`),
    'derivative identity',
  )
  if (
    Object.entries(parsed.counts).some(([key, count]) => count !== (parsed[key as keyof CatalogSnapshot | 'files'] as unknown[]).length)
  ) throw new CatalogTransferError('Catalog transfer manifest counts are invalid')
  return parsed
}

function verifyRelations(manifest: Manifest): void {
  const assets = new Map(manifest.assets.map((row) => [row.id, row]))
  const versions = new Map(manifest.versions.map((row) => [row.id, row]))
  const tags = new Set(manifest.tags.map((row) => row.id))
  const objects = new Map(manifest.objects.map((row) => [row.digest, row]))
  for (const asset of manifest.assets) {
    const current = versions.get(asset.currentVersionId)
    if (
      !current || current.assetId !== asset.id || !['verified', 'available'].includes(current.status) ||
      asset.tagIds.some((id) => !tags.has(id))
    ) throw new CatalogTransferError('Catalog transfer asset current version or tags are invalid')
    const currentPairs = new Map<string, { kinds: Set<string>; diagnostic: string | null }>()
    for (const derivative of manifest.derivatives.filter((item) => item.templateVersionId === current.id)) {
      const pair = currentPairs.get(derivative.rendererVersion) ?? { kinds: new Set<string>(), diagnostic: null }
      const diagnostic = canonical(derivative.securityDiagnostic)
      if (pair.diagnostic !== null && pair.diagnostic !== diagnostic) {
        throw new CatalogTransferError('Catalog transfer current preview pair is inconsistent')
      }
      pair.diagnostic = diagnostic
      pair.kinds.add(derivative.kind)
      currentPairs.set(derivative.rendererVersion, pair)
    }
    if (![...currentPairs.values()].some((pair) => pair.kinds.has('preview') && pair.kinds.has('thumbnail'))) {
      throw new CatalogTransferError('Catalog transfer current preview pair is incomplete')
    }
  }
  for (const version of manifest.versions) {
    if (!assets.has(version.assetId) || !objects.has(version.contentObjectDigest)) {
      throw new CatalogTransferError('Catalog transfer version relation is invalid')
    }
  }
  for (const derivative of manifest.derivatives) {
    const version = versions.get(derivative.templateVersionId)
    if (!version || version.sourceDigest !== derivative.sourceDigest || objects.get(derivative.contentDigest)?.mediaType !== 'image/png') {
      throw new CatalogTransferError('Catalog transfer derivative relation is invalid')
    }
  }
  if (
    manifest.files.length !== manifest.objects.length || manifest.files.some((file) => {
      const object = objects.get(file.sha256)
      return !object || file.byteSize !== object.byteSize || file.mediaType !== object.mediaType
    })
  ) throw new CatalogTransferError('Catalog transfer files do not match objects')
  const state: CatalogSnapshot = {
    assets: manifest.assets,
    versions: manifest.versions,
    tags: manifest.tags,
    derivatives: manifest.derivatives,
    objects: manifest.objects,
  }
  if (sha256(canonical(state)) !== manifest.sourceCatalogStateSha256) {
    throw new CatalogTransferError('Catalog transfer source catalog state hash is invalid')
  }
}

function immutableVersion(row: Record<string, unknown>, source: Version): boolean {
  return row.asset_id === source.assetId && row.version_number === source.versionNumber &&
    row.contract_version === source.contractVersion && row.source_digest === source.sourceDigest &&
    row.content_object_digest === source.contentObjectDigest &&
    canonical(JSON.parse(String(row.slot_schema))) === canonical(source.slotSchema)
}

function targetSecurityDiagnostic(value: unknown): string | null {
  try {
    return canonical(securityDiagnostic(JSON.parse(String(value))))
  } catch {
    return null
  }
}

function sourceDerivativeState(derivative: Derivative): string {
  return canonical({
    templateVersionId: derivative.templateVersionId,
    kind: derivative.kind,
    sourceDigest: derivative.sourceDigest,
    contentDigest: derivative.contentDigest,
    rendererVersion: derivative.rendererVersion,
    securityDiagnostic: canonical(derivative.securityDiagnostic),
    createdAt: derivative.createdAt,
  })
}

function targetDerivativeState(row: Record<string, unknown>): string {
  return canonical({
    templateVersionId: String(row.template_version_id),
    kind: String(row.kind),
    sourceDigest: String(row.source_digest),
    contentDigest: String(row.content_digest),
    rendererVersion: String(row.renderer_version),
    securityDiagnostic: targetSecurityDiagnostic(row.security_diagnostic),
    createdAt: Number(row.created_at),
  })
}

function sourceDerivativeStates(manifest: Manifest, versionId: string): string[] {
  return manifest.derivatives.filter((derivative) => derivative.templateVersionId === versionId).map(sourceDerivativeState).sort()
}

function targetDerivativeStates(database: Database, versionId: string): string[] {
  return rows(
    database,
    'SELECT template_version_id,kind,source_digest,content_digest,renderer_version,security_diagnostic,created_at FROM template_preview_derivatives WHERE template_version_id=?',
    versionId,
  ).map(targetDerivativeState).sort()
}

function derivativeSetMatches(database: Database, manifest: Manifest, versionId: string): boolean {
  return canonical(targetDerivativeStates(database, versionId)) === canonical(sourceDerivativeStates(manifest, versionId))
}

export class CatalogTransferService {
  private readonly database: Database
  private readonly contentStore: LocalContentStore
  private readonly stagingRoot: string
  private readonly sourceReleaseSha: string
  private readonly readOnly: boolean

  constructor(
    options: { database: Database; contentStore: LocalContentStore; stagingRoot: string; sourceReleaseSha: string; readOnly?: boolean },
  ) {
    this.database = options.database
    this.contentStore = options.contentStore
    this.stagingRoot = resolve(options.stagingRoot)
    this.sourceReleaseSha = options.sourceReleaseSha
    this.readOnly = options.readOnly ?? false
  }

  async exportArchive(): Promise<Buffer> {
    if (!RELEASE_SHA.test(this.sourceReleaseSha)) throw new CatalogTransferError('Source release SHA is unavailable', 409)
    const snapshot = sourceSnapshot(this.database)
    const files: TransferFile[] = snapshot.objects.map((object) => ({
      path: objectPath(object.digest),
      sha256: object.digest,
      byteSize: object.byteSize,
      mediaType: object.mediaType,
    }))
    const manifest: Manifest = {
      contractVersion: CONTRACT,
      sourceReleaseSha: this.sourceReleaseSha,
      sourceCatalogStateSha256: sha256(canonical(snapshot)),
      ...snapshot,
      files,
      counts: {
        assets: snapshot.assets.length,
        versions: snapshot.versions.length,
        tags: snapshot.tags.length,
        derivatives: snapshot.derivatives.length,
        objects: snapshot.objects.length,
        files: files.length,
      },
    }
    verifyRelations(manifest)
    const zip = new JSZip()
    zip.file(MANIFEST_PATH, `${canonical(manifest)}\n`, { date: ZIP_EPOCH, createFolders: false })
    const verifiedFiles = new Map<string, Buffer>()
    for (const file of files) {
      const bytes = this.contentStore.read(file.sha256)
      if (bytes.byteLength !== file.byteSize || sha256(bytes) !== file.sha256) {
        throw new CatalogTransferError('Source content object hash or size verification failed', 409)
      }
      verifiedFiles.set(file.sha256, bytes)
      zip.file(file.path, bytes, { binary: true, date: ZIP_EPOCH, createFolders: false })
    }
    this.verifyTemplateObjects(manifest, verifiedFiles)
    const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE', platform: 'UNIX' })
    if (archive.byteLength > MAX_CATALOG_TRANSFER_ARCHIVE_BYTES) throw new CatalogTransferError('Catalog transfer ZIP size is invalid', 409)
    return archive
  }

  async validateArchive(content: Uint8Array): Promise<CatalogTransferValidation> {
    const parsed = await this.parseArchive(content)
    this.assertTargetConflicts(parsed.manifest)
    const targetCatalogStateSha256 = targetCatalogState(this.database)
    const validation = {
      transferId: `transfer-${parsed.manifestSha256}`,
      manifestSha256: parsed.manifestSha256,
      sourceCatalogStateSha256: parsed.manifest.sourceCatalogStateSha256,
      targetCatalogStateSha256,
      diff: this.diff(parsed.manifest),
    }
    mkdirSync(this.stagingRoot, { recursive: true, mode: 0o700 })
    chmodSync(this.stagingRoot, 0o700)
    const destination = join(this.stagingRoot, `${validation.transferId}.zip`)
    const bytes = Buffer.from(content)
    if (existsSync(destination)) {
      if (sha256(readFileSync(destination)) !== sha256(bytes)) throw new CatalogTransferError('Staged transfer identity conflicts', 409)
    } else {
      const temporary = join(this.stagingRoot, `.${validation.transferId}.${process.pid}.${randomUUID()}.tmp`)
      const descriptor = openSync(temporary, 'wx', 0o600)
      try {
        writeFileSync(descriptor, bytes)
      } finally {
        closeSync(descriptor)
      }
      try {
        renameSync(temporary, destination)
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary)
      }
      chmodSync(destination, 0o600)
    }
    return validation
  }

  async apply(
    transferId: string,
    input: { expectedManifestSha256: string; expectedTargetCatalogStateSha256: string },
  ): Promise<
    {
      applied: true
      manifestSha256: string
      targetCatalogStateSha256: string
      protectedState: CatalogTransferProtectedState
      diff: CatalogTransferDiff
    }
  > {
    if (this.readOnly) throw new CatalogTransferError('APP_READ_ONLY', 503)
    if (
      transferId !== `transfer-${input.expectedManifestSha256}` || !SHA256.test(input.expectedManifestSha256) ||
      !SHA256.test(input.expectedTargetCatalogStateSha256)
    ) throw new CatalogTransferError('Catalog transfer apply identity is invalid', 409)
    const path = resolve(this.stagingRoot, `${transferId}.zip`)
    if (relative(this.stagingRoot, path).startsWith('..') || basename(path) !== `${transferId}.zip` || !existsSync(path)) {
      throw new CatalogTransferError('Catalog transfer not found', 404)
    }
    const bytes = readFileSync(path)
    const parsed = await this.parseArchive(bytes)
    if (parsed.manifestSha256 !== input.expectedManifestSha256) throw new CatalogTransferError('Catalog transfer manifest changed', 409)
    if (targetCatalogState(this.database) !== input.expectedTargetCatalogStateSha256) {
      throw new CatalogTransferError('Target catalog state changed', 409)
    }
    // Append only fully verified objects. If the following database transaction
    // fails, these immutable verified bytes may remain unreferenced but no
    // unverified archive content can enter the live CAS.
    for (const object of parsed.manifest.objects) {
      const content = parsed.files.get(object.digest)!
      const stored = this.contentStore.put(content, object.mediaType)
      if (stored.digest !== object.digest || stored.byteSize !== object.byteSize || stored.relativePath !== object.relativePath) {
        throw new CatalogTransferError('Catalog transfer CAS append verification failed', 409)
      }
    }
    const result = this.database.transaction(() => {
      const currentState = targetCatalogState(this.database)
      if (currentState !== input.expectedTargetCatalogStateSha256) throw new CatalogTransferError('Target catalog state changed', 409)
      this.assertTargetConflicts(parsed.manifest)
      const diff = this.diff(parsed.manifest)
      const protectedBefore = protectedState(this.database)
      for (const object of parsed.manifest.objects) {
        const existing = this.database.prepare('SELECT media_type,byte_size,relative_path,created_at FROM content_objects WHERE digest=?')
          .get(object.digest) as Record<string, unknown> | undefined
        if (!existing) {
          this.database.prepare('INSERT INTO content_objects (digest,media_type,byte_size,relative_path,created_at) VALUES (?,?,?,?,?)')
            .run(object.digest, object.mediaType, object.byteSize, object.relativePath, object.createdAt)
        }
      }
      for (const asset of parsed.manifest.assets) {
        const existing = this.database.prepare('SELECT 1 FROM template_assets WHERE id=?').get(asset.id)
        if (!existing) {
          this.database.prepare(
            "INSERT INTO template_assets (id,title,summary,category,status,current_version_id,created_at,updated_at) VALUES (?,?,?,?,'active',NULL,?,?)",
          ).run(asset.id, asset.title, asset.summary, asset.category, asset.createdAt, asset.updatedAt)
        }
      }
      for (const version of parsed.manifest.versions) {
        const existing = this.database.prepare('SELECT 1 FROM template_versions WHERE id=?').get(version.id)
        if (!existing) {
          this.database.prepare(
            'INSERT INTO template_versions (id,asset_id,version_number,contract_version,source_digest,content_object_digest,slot_schema,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          ).run(
            version.id,
            version.assetId,
            version.versionNumber,
            version.contractVersion,
            version.sourceDigest,
            version.contentObjectDigest,
            canonical(version.slotSchema),
            version.status,
            version.createdAt,
          )
        } else if (version.status === 'verified' || version.status === 'available') {
          this.database.prepare('UPDATE template_versions SET status=? WHERE id=?').run(version.status, version.id)
        }
      }
      for (const tag of parsed.manifest.tags) {
        const existing = this.database.prepare('SELECT 1 FROM tags WHERE id=?').get(tag.id)
        if (!existing) this.database.prepare('INSERT INTO tags (id,label,created_at) VALUES (?,?,?)').run(tag.id, tag.label, tag.createdAt)
      }
      const derivativeVersionIds = parsed.manifest.versions.filter((version) =>
        !derivativeSetMatches(this.database, parsed.manifest, version.id)
      ).map((version) => version.id)
      const derivativeVersionIdsWithTargetRows = derivativeVersionIds.filter((versionId) =>
        targetDerivativeStates(this.database, versionId).length > 0
      )
      if (derivativeVersionIdsWithTargetRows.length > 0) {
        const trigger = this.database.prepare(
          "SELECT sql FROM sqlite_master WHERE type='trigger' AND name=? AND tbl_name='template_preview_derivatives'",
        ).get(DERIVATIVE_DELETE_TRIGGER) as { sql: unknown } | undefined
        if (typeof trigger?.sql !== 'string' || trigger.sql.trim().length === 0) {
          throw new CatalogTransferError('Catalog transfer derivative delete guard is unavailable', 409)
        }
        const derivativeDeleteTriggerSql = trigger.sql
        this.database.exec(`DROP TRIGGER ${DERIVATIVE_DELETE_TRIGGER}`)
        try {
          for (const versionId of derivativeVersionIdsWithTargetRows) {
            this.database.prepare('DELETE FROM template_preview_derivatives WHERE template_version_id=?').run(versionId)
          }
        } finally {
          this.database.exec(derivativeDeleteTriggerSql)
        }
      }
      const changedDerivativeVersions = new Set(derivativeVersionIds)
      for (const derivative of parsed.manifest.derivatives.filter((item) => changedDerivativeVersions.has(item.templateVersionId))) {
        this.database.prepare(
          'INSERT INTO template_preview_derivatives (template_version_id,kind,source_digest,content_digest,renderer_version,security_diagnostic,created_at) VALUES (?,?,?,?,?,?,?)',
        ).run(
          derivative.templateVersionId,
          derivative.kind,
          derivative.sourceDigest,
          derivative.contentDigest,
          derivative.rendererVersion,
          canonical(derivative.securityDiagnostic),
          derivative.createdAt,
        )
      }
      for (const asset of parsed.manifest.assets) {
        this.database.prepare('DELETE FROM template_asset_tags WHERE asset_id=?').run(asset.id)
        for (const tagId of asset.tagIds) {
          this.database.prepare('INSERT INTO template_asset_tags (asset_id,tag_id) VALUES (?,?)').run(asset.id, tagId)
        }
        this.database.prepare(
          "UPDATE template_assets SET title=?,summary=?,category=?,status='active',current_version_id=?,updated_at=? WHERE id=?",
        ).run(asset.title, asset.summary, asset.category, asset.currentVersionId, asset.updatedAt, asset.id)
      }
      for (const version of parsed.manifest.versions) {
        this.database.prepare('UPDATE template_versions SET status=? WHERE id=?').run(version.status, version.id)
      }
      const sourceIds = new Set(parsed.manifest.assets.map((asset) => asset.id))
      for (const row of rows(this.database, "SELECT id FROM template_assets WHERE status='active' ORDER BY id")) {
        if (!sourceIds.has(String(row.id))) {
          this.database.prepare("UPDATE template_assets SET status='retired',updated_at=? WHERE id=?").run(Date.now(), row.id)
        }
      }
      const protectedAfter = protectedState(this.database)
      if (canonical(protectedAfter) !== canonical(protectedBefore)) {
        throw new CatalogTransferError('Protected application state changed during catalog apply', 409)
      }
      new AuditEventWriter(this.database).record({
        action: 'admin.catalog_transfer_apply',
        entityType: 'catalog_transfer',
        entityId: transferId,
        result: 'success',
        diagnostic: 'CATALOG_TRANSFER_APPLIED',
      })
      return { protectedState: protectedBefore, diff, targetCatalogStateSha256: targetCatalogState(this.database) }
    }).immediate()
    return {
      applied: true,
      manifestSha256: parsed.manifestSha256,
      targetCatalogStateSha256: result.targetCatalogStateSha256,
      protectedState: result.protectedState,
      diff: result.diff,
    }
  }

  private async parseArchive(content: Uint8Array): Promise<{ manifest: Manifest; manifestSha256: string; files: Map<string, Buffer> }> {
    const bytes = Buffer.from(content)
    if (bytes.byteLength < 22 || bytes.byteLength > MAX_CATALOG_TRANSFER_ARCHIVE_BYTES) {
      throw new CatalogTransferError('Catalog transfer ZIP size is invalid')
    }
    const names = centralDirectoryNames(bytes)
    for (const name of names) safePath(name)
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false })
    } catch {
      throw new CatalogTransferError('Catalog transfer ZIP structure or CRC is invalid')
    }
    const entries = Object.values(zip.files)
    if (entries.length !== names.length || entries.length > MAX_ENTRIES) {
      throw new CatalogTransferError('Catalog transfer ZIP entry table is invalid')
    }
    let expanded = 0
    for (const entry of entries) {
      const original = (entry as JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name
      if (original !== entry.name || entry.dir) throw new CatalogTransferError('Catalog transfer ZIP contains an unsafe path')
      expanded += entrySize(entry)
    }
    if (expanded > MAX_EXPANDED_BYTES) throw new CatalogTransferError('Catalog transfer ZIP expanded size is invalid')
    const manifestEntry = zip.file(MANIFEST_PATH)
    if (!manifestEntry || entrySize(manifestEntry) > MAX_MANIFEST_BYTES) {
      throw new CatalogTransferError('Catalog transfer manifest is missing or too large')
    }
    const manifestBytes = Buffer.from(await manifestEntry.async('uint8array'))
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes))
    } catch {
      throw new CatalogTransferError('Catalog transfer manifest is invalid UTF-8 JSON')
    }
    const manifest = parseManifest(value)
    if (`${canonical(value)}\n` !== manifestBytes.toString('utf8')) {
      throw new CatalogTransferError('Catalog transfer manifest is not canonical')
    }
    verifyRelations(manifest)
    const expectedNames = [MANIFEST_PATH, ...manifest.files.map((file) => file.path)].sort()
    if (canonical([...names].sort()) !== canonical(expectedNames)) {
      throw new CatalogTransferError('Catalog transfer ZIP entries do not exactly match manifest files')
    }
    const files = new Map<string, Buffer>()
    for (const file of manifest.files) {
      const entry = zip.file(file.path)
      if (!entry) throw new CatalogTransferError('Catalog transfer object is missing')
      const object = Buffer.from(await entry.async('uint8array'))
      if (object.byteLength !== file.byteSize || sha256(object) !== file.sha256) {
        throw new CatalogTransferError('Catalog transfer object hash or size verification failed')
      }
      files.set(file.sha256, object)
    }
    this.verifyTemplateObjects(manifest, files)
    return { manifest, manifestSha256: sha256(manifestBytes), files }
  }

  private verifyTemplateObjects(manifest: Manifest, files: Map<string, Buffer>): void {
    const objects = new Map(manifest.objects.map((object) => [object.digest, object]))
    const packages = new Map<string, TemplatePackageSource>()
    for (const version of manifest.versions) {
      const bytes = files.get(version.contentObjectDigest)
      const object = objects.get(version.contentObjectDigest)
      if (!bytes || object?.mediaType !== 'application/vnd.html-template-package+json') {
        throw new CatalogTransferError('Catalog transfer template object is missing')
      }
      let source: TemplatePackageSource
      try {
        source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as TemplatePackageSource
        assertValidTemplatePackage(source)
        if (!serializeTemplatePackage(source).equals(bytes)) throw new Error('canonical')
        if (
          source.manifest.id !== version.assetId || source.manifest.version !== version.versionNumber ||
          source.manifest.contractVersion !== version.contractVersion
        ) throw new Error('identity')
        if (canonical(version.slotSchema) !== canonical({ slots: source.manifest.slots })) throw new Error('slot schema')
        if (version.contractVersion === TEMPLATE_PACKAGE_CONTRACT_VERSION) assertSafePreviewPackage(source)
        else assertSafeInteractiveTemplatePackage(source)
      } catch {
        throw new CatalogTransferError('Catalog transfer template package verification failed')
      }
      if (
        version.contractVersion === INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION && ['verified', 'available'].includes(version.status) &&
        !isAllowlistedInteractiveTemplateDigest(version.sourceDigest)
      ) throw new CatalogTransferError('Catalog transfer interactive template digest is not allowlisted')
      packages.set(version.id, source)
    }
    for (const asset of manifest.assets) {
      const source = packages.get(asset.currentVersionId)
      if (
        !source || source.manifest.title !== asset.title || source.manifest.summary !== asset.summary ||
        source.manifest.category !== asset.category ||
        canonical([...source.manifest.tags].sort()) !==
          canonical([...asset.tagIds.map((id) => manifest.tags.find((tag) => tag.id === id)!.label)].sort())
      ) throw new CatalogTransferError('Catalog transfer current template metadata is inconsistent')
    }
    for (const derivative of manifest.derivatives) {
      const bytes = files.get(derivative.contentDigest)
      const expected = derivative.kind === 'preview' ? { width: 1280, height: 720 } : { width: 320, height: 180 }
      if (
        !bytes || bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        bytes.readUInt32BE(16) !== expected.width || bytes.readUInt32BE(20) !== expected.height
      ) throw new CatalogTransferError('Catalog transfer derivative PNG is invalid')
    }
  }

  private assertTargetConflicts(manifest: Manifest): void {
    for (const object of manifest.objects) {
      const row = this.database.prepare('SELECT media_type,byte_size,relative_path,created_at FROM content_objects WHERE digest=?').get(
        object.digest,
      ) as Record<string, unknown> | undefined
      if (row && (row.media_type !== object.mediaType || row.byte_size !== object.byteSize || row.relative_path !== object.relativePath)) {
        throw new CatalogTransferError('Catalog transfer content object conflict', 409)
      }
    }
    for (const version of manifest.versions) {
      const row = this.database.prepare(
        'SELECT asset_id,version_number,contract_version,source_digest,content_object_digest,slot_schema,status,created_at FROM template_versions WHERE id=?',
      ).get(version.id) as Record<string, unknown> | undefined
      if (row && !immutableVersion(row, version)) throw new CatalogTransferError('Catalog transfer version id conflict', 409)
      const byNumber = this.database.prepare(
        'SELECT id FROM template_versions WHERE asset_id=? AND version_number=?',
      ).get(version.assetId, version.versionNumber) as { id: string } | undefined
      if (byNumber && byNumber.id !== version.id) throw new CatalogTransferError('Catalog transfer version number conflict', 409)
    }
    for (const tag of manifest.tags) {
      const byId = this.database.prepare('SELECT label FROM tags WHERE id=?').get(tag.id) as Record<string, unknown> | undefined
      const byLabel = this.database.prepare('SELECT id FROM tags WHERE label=?').get(tag.label) as Record<string, unknown> | undefined
      if ((byId && byId.label !== tag.label) || (byLabel && byLabel.id !== tag.id)) {
        throw new CatalogTransferError('Catalog transfer tag conflict', 409)
      }
    }
    for (const derivative of manifest.derivatives) {
      const row = this.database.prepare(
        'SELECT content_digest,security_diagnostic,created_at FROM template_preview_derivatives WHERE template_version_id=? AND kind=? AND source_digest=? AND renderer_version=?',
      ).get(derivative.templateVersionId, derivative.kind, derivative.sourceDigest, derivative.rendererVersion) as
        | Record<string, unknown>
        | undefined
      if (
        row && (
          row.content_digest !== derivative.contentDigest ||
          targetSecurityDiagnostic(row.security_diagnostic) !== canonical(derivative.securityDiagnostic) ||
          Number(row.created_at) !== derivative.createdAt
        )
      ) {
        throw new CatalogTransferError('Catalog transfer derivative conflict', 409)
      }
    }
  }

  private diff(manifest: Manifest): CatalogTransferDiff {
    const activate: string[] = []
    const update: string[] = []
    const reuse: string[] = []
    const sourceIds = new Set(manifest.assets.map((asset) => asset.id))
    for (const asset of manifest.assets) {
      const row = this.database.prepare('SELECT title,summary,category,status,current_version_id FROM template_assets WHERE id=?').get(
        asset.id,
      ) as Record<string, unknown> | undefined
      const tags = (this.database.prepare('SELECT tag_id FROM template_asset_tags WHERE asset_id=? ORDER BY tag_id').all(asset.id) as {
        tag_id: string
      }[]).map((item) => item.tag_id)
      const sourceVersions = manifest.versions.filter((version) => version.assetId === asset.id)
      const versionsChanged = sourceVersions.some((version) => {
        const target = this.database.prepare('SELECT status FROM template_versions WHERE id=?').get(version.id) as
          | { status: string }
          | undefined
        return !target || target.status !== version.status
      })
      const derivativesChanged = sourceVersions.some((version) => !derivativeSetMatches(this.database, manifest, version.id))
      if (!row || row.status === 'retired') activate.push(asset.id)
      else if (
        row.title !== asset.title || row.summary !== asset.summary || row.category !== asset.category ||
        row.current_version_id !== asset.currentVersionId || canonical(tags) !== canonical(asset.tagIds) || versionsChanged ||
        derivativesChanged
      ) update.push(asset.id)
      else reuse.push(asset.id)
    }
    const retire = rows(this.database, "SELECT id FROM template_assets WHERE status='active' ORDER BY id").map((row) => String(row.id))
      .filter((id) => !sourceIds.has(id))
    return { activate: activate.sort(), update: update.sort(), reuse: reuse.sort(), retire: retire.sort() }
  }
}
