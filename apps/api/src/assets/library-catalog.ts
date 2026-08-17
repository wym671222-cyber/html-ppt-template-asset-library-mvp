import type BetterSqlite3 from 'better-sqlite3'
import { INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION, TEMPLATE_PACKAGE_CONTRACT_VERSION, type TemplatePackageSource } from '@slide-maker/shared'
import { isUserId, type OwnerContext } from '../owner.js'
import { isAllowlistedInteractiveTemplateDigest } from '../templates/interactive-template-allowlist.js'
import {
  compileInteractiveTemplateRuntime,
  InteractiveTemplateRuntimeError,
  type CompiledInteractiveTemplateRuntime,
} from '../templates/interactive-template-runtime.js'
import { compileStaticTemplateRuntime, StaticTemplateRuntimeError, type CompiledStaticTemplateRuntime } from '../templates/static-template-runtime.js'
import { AssetCatalogRepository, type RetiredTemplate } from './catalog-repository.js'
import { LocalContentStore } from './content-store.js'

type Database = BetterSqlite3.Database

const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SEARCH_LENGTH = 100
const MAX_FILTER_LENGTH = 80
const MAX_TAGS = 5
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 48
const MAX_OFFSET = 10_000

export class CatalogRequestError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message)
  }
}

export type CatalogQuery = Readonly<{
  search: string
  category: string | null
  tags: string[]
  status: 'verified' | 'available' | null
  sort: 'updated-desc' | 'title-asc'
  limit: number
  offset: number
}>

export type CatalogItem = Readonly<{
  id: string
  title: string
  summary: string
  category: string
  tags: string[]
  version: {
    id: string
    number: number
    status: 'verified' | 'available'
    contractVersion: string
    isCurrent: true
  }
  runtime: null | {
    mode: 'sandboxed-static' | 'sandboxed-js'
    viewport: { width: 1920; height: 1080 }
    url: string
    commands: Array<'replay' | 'reset'>
  }
  derivative: {
    rendererVersion: string
    previewUrl: string
    thumbnailUrl: string
    createdAt: number
  }
}>

export type CatalogResponse = Readonly<{
  items: CatalogItem[]
  facets: {
    categories: Array<{ value: string; count: number }>
    tags: Array<{ value: string; count: number }>
    statuses: Array<{ value: 'verified' | 'available'; count: number }>
  }
  total: number
  limit: number
  offset: number
}>

type AssetRow = {
  id: string
  title: string
  summary: string
  category: string
  version_id: string
  version_number: number
  version_status: 'verified' | 'available'
  contract_version: string
  source_digest: string
  renderer_version: string
  derivative_created_at: number
}

type DerivativeRow = {
  content_digest: string
  media_type: string
  byte_size: number
  relative_path: string
}

type RuntimeRow = {
  asset_id: string
  version_number: number
  contract_version: string
  source_digest: string
  content_digest: string
  media_type: string
  byte_size: number
  relative_path: string
}

export type CompiledCatalogRuntime = CompiledStaticTemplateRuntime | (CompiledInteractiveTemplateRuntime & { mode: 'sandboxed-js' })

function assertOwner(owner: OwnerContext): void {
  if (owner.kind !== 'user' || !isUserId(owner.id)) throw new CatalogRequestError('Authenticated user OwnerContext required', 404)
}

function boundedFilter(value: string | null, name: string, maxLength = MAX_FILTER_LENGTH): string | null {
  if (value === null || value.trim() === '') return null
  const normalized = value.trim()
  if (normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) throw new CatalogRequestError(`${name} is invalid`)
  return normalized
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

export function parseCatalogQuery(url: string): CatalogQuery {
  const parameters = new URL(url).searchParams
  const allowed = new Set(['search', 'category', 'tags', 'status', 'sort', 'limit', 'offset'])
  for (const key of parameters.keys()) if (!allowed.has(key)) throw new CatalogRequestError(`Unknown catalog query parameter: ${key}`)
  for (const key of allowed) if (parameters.getAll(key).length > 1) throw new CatalogRequestError(`Catalog query parameter must not repeat: ${key}`)

  const search = boundedFilter(parameters.get('search'), 'search', MAX_SEARCH_LENGTH) ?? ''
  const category = boundedFilter(parameters.get('category'), 'category')
  const rawTags = parameters.get('tags')
  const tags = rawTags === null || rawTags.trim() === '' ? [] : rawTags.split(',').map((tag) => {
    const value = boundedFilter(tag, 'tag', 40)
    if (value === null) throw new CatalogRequestError('tags must not contain empty values')
    return value
  })
  if (tags.length > MAX_TAGS || new Set(tags).size !== tags.length) throw new CatalogRequestError('tags must contain at most five unique values')

  const rawStatus = parameters.get('status')
  const status = rawStatus === null || rawStatus === '' ? null : rawStatus
  if (status !== null && status !== 'verified' && status !== 'available') throw new CatalogRequestError('status must be verified or available')

  const rawSort = parameters.get('sort') ?? 'updated-desc'
  if (rawSort !== 'updated-desc' && rawSort !== 'title-asc') throw new CatalogRequestError('sort must be updated-desc or title-asc')

  const rawLimit = parameters.get('limit')
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new CatalogRequestError(`limit must be an integer between 1 and ${MAX_LIMIT}`)
  const rawOffset = parameters.get('offset')
  const offset = rawOffset === null ? 0 : Number(rawOffset)
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw new CatalogRequestError(`offset must be an integer between 0 and ${MAX_OFFSET}`)
  return { search, category, tags, status, sort: rawSort, limit, offset }
}

function assertAssetId(assetId: string): void {
  if (assetId.length > 100 || !ASSET_ID.test(assetId)) throw new CatalogRequestError('Asset id is invalid')
}

function assertPng(content: Buffer, kind: 'preview' | 'thumbnail'): void {
  const expected = kind === 'preview' ? { width: 1280, height: 720 } : { width: 320, height: 180 }
  if (content.length < 24
    || content.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || content.subarray(12, 16).toString('ascii') !== 'IHDR'
    || content.readUInt32BE(16) !== expected.width
    || content.readUInt32BE(20) !== expected.height) {
    throw new CatalogRequestError('Registered derivative is not the required PNG', 409)
  }
}

export class AssetLibraryCatalog {
  constructor(private readonly database: Database, private readonly contentStore: LocalContentStore) {}

  list(owner: OwnerContext, query: CatalogQuery): CatalogResponse {
    assertOwner(owner)
    const clauses = [
      "a.status = 'active'",
      "v.status IN ('verified', 'available')",
      'a.current_version_id = v.id',
      'v.content_object_digest = v.source_digest',
    ]
    const parameters: unknown[] = []
    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`
      clauses.push("(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\' OR a.category LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM template_asset_tags search_at JOIN tags search_t ON search_t.id = search_at.tag_id WHERE search_at.asset_id = a.id AND search_t.label LIKE ? ESCAPE '\\'))")
      parameters.push(pattern, pattern, pattern, pattern)
    }
    if (query.category) {
      clauses.push('a.category = ?')
      parameters.push(query.category)
    }
    if (query.status) {
      clauses.push('v.status = ?')
      parameters.push(query.status)
    }
    for (const tag of query.tags) {
      clauses.push('EXISTS (SELECT 1 FROM template_asset_tags filter_at JOIN tags filter_t ON filter_t.id = filter_at.tag_id WHERE filter_at.asset_id = a.id AND filter_t.label = ?)')
      parameters.push(tag)
    }

    const availablePairClause = `
      preview.renderer_version = (
        SELECT pair_preview.renderer_version
        FROM template_preview_derivatives pair_preview
        JOIN template_preview_derivatives pair_thumbnail
          ON pair_thumbnail.template_version_id = pair_preview.template_version_id
          AND pair_thumbnail.source_digest = pair_preview.source_digest
          AND pair_thumbnail.renderer_version = pair_preview.renderer_version
          AND pair_thumbnail.kind = 'thumbnail'
        JOIN content_objects pair_preview_object ON pair_preview_object.digest = pair_preview.content_digest AND pair_preview_object.media_type = 'image/png'
        JOIN content_objects pair_thumbnail_object ON pair_thumbnail_object.digest = pair_thumbnail.content_digest AND pair_thumbnail_object.media_type = 'image/png'
        WHERE pair_preview.template_version_id = v.id
          AND pair_preview.source_digest = v.source_digest
          AND pair_preview.kind = 'preview'
        ORDER BY max(pair_preview.created_at, pair_thumbnail.created_at) DESC, pair_preview.renderer_version DESC
        LIMIT 1
      )
    `
    const baseQuery = `
      SELECT a.id, a.title, a.summary, a.category,
        v.id AS version_id, v.version_number, v.status AS version_status,
        v.contract_version, v.source_digest,
        preview.renderer_version,
        max(preview.created_at, thumbnail.created_at) AS derivative_created_at
      FROM template_assets a
      JOIN template_versions v ON v.id = a.current_version_id AND v.asset_id = a.id
      JOIN template_preview_derivatives preview
        ON preview.template_version_id = v.id AND preview.kind = 'preview' AND preview.source_digest = v.source_digest
      JOIN template_preview_derivatives thumbnail
        ON thumbnail.template_version_id = v.id AND thumbnail.kind = 'thumbnail'
        AND thumbnail.source_digest = v.source_digest AND thumbnail.renderer_version = preview.renderer_version
      JOIN content_objects preview_object ON preview_object.digest = preview.content_digest AND preview_object.media_type = 'image/png'
      JOIN content_objects thumbnail_object ON thumbnail_object.digest = thumbnail.content_digest AND thumbnail_object.media_type = 'image/png'
      WHERE ${clauses.join(' AND ')}
        AND ${availablePairClause}
    `
    const orderBy = query.sort === 'title-asc'
      ? 'a.title COLLATE NOCASE ASC, a.id ASC'
      : 'max(preview.created_at, thumbnail.created_at) DESC, a.id ASC'
    const rows = this.database.prepare(`${baseQuery} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...parameters, query.limit, query.offset) as AssetRow[]
    const total = Number((this.database.prepare(`SELECT count(*) AS count FROM (${baseQuery})`).get(...parameters) as { count: number }).count)

    const items = rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      category: row.category,
      tags: (this.database.prepare('SELECT t.label FROM template_asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = ? ORDER BY t.label COLLATE NOCASE ASC, t.id ASC LIMIT 100').all(row.id) as { label: string }[]).map(({ label }) => label),
      version: { id: row.version_id, number: row.version_number, status: row.version_status, contractVersion: row.contract_version, isCurrent: true as const },
      runtime: row.contract_version === TEMPLATE_PACKAGE_CONTRACT_VERSION
        || (row.contract_version === INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION && isAllowlistedInteractiveTemplateDigest(row.source_digest))
        ? {
            mode: row.contract_version === INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION ? 'sandboxed-js' as const : 'sandboxed-static' as const,
            viewport: { width: 1920 as const, height: 1080 as const },
            url: `/api/catalog/assets/${encodeURIComponent(row.id)}/runtime`,
            commands: row.contract_version === INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION ? ['replay' as const, 'reset' as const] : [],
          }
        : null,
      derivative: {
        rendererVersion: row.renderer_version,
        previewUrl: `/api/catalog/assets/${encodeURIComponent(row.id)}/preview`,
        thumbnailUrl: `/api/catalog/assets/${encodeURIComponent(row.id)}/thumbnail`,
        createdAt: row.derivative_created_at,
      },
    }))

    const categories = (this.database.prepare(`
      SELECT a.category AS value, count(*) AS count
      FROM template_assets a JOIN template_versions v ON v.id = a.current_version_id AND v.asset_id = a.id
      WHERE a.status = 'active' AND v.status IN ('verified', 'available') AND v.content_object_digest = v.source_digest
        AND EXISTS (
          SELECT 1 FROM template_preview_derivatives p JOIN template_preview_derivatives t
            ON t.template_version_id = p.template_version_id AND t.source_digest = p.source_digest AND t.renderer_version = p.renderer_version AND t.kind = 'thumbnail'
          JOIN content_objects po ON po.digest = p.content_digest AND po.media_type = 'image/png'
          JOIN content_objects tob ON tob.digest = t.content_digest AND tob.media_type = 'image/png'
          WHERE p.template_version_id = v.id AND p.source_digest = v.source_digest AND p.kind = 'preview'
        )
      GROUP BY a.category
      ORDER BY a.category COLLATE NOCASE ASC LIMIT 100
    `).all() as Array<{ value: string; count: number }>)
    const tags = (this.database.prepare(`
      SELECT tag.label AS value, count(DISTINCT a.id) AS count
      FROM tags tag
      JOIN template_asset_tags at ON at.tag_id = tag.id
      JOIN template_assets a ON a.id = at.asset_id
      JOIN template_versions v ON v.id = a.current_version_id AND v.asset_id = a.id
      WHERE a.status = 'active' AND v.status IN ('verified', 'available') AND v.content_object_digest = v.source_digest
        AND EXISTS (
          SELECT 1 FROM template_preview_derivatives p JOIN template_preview_derivatives t
            ON t.template_version_id = p.template_version_id AND t.source_digest = p.source_digest AND t.renderer_version = p.renderer_version AND t.kind = 'thumbnail'
          JOIN content_objects po ON po.digest = p.content_digest AND po.media_type = 'image/png'
          JOIN content_objects tob ON tob.digest = t.content_digest AND tob.media_type = 'image/png'
          WHERE p.template_version_id = v.id AND p.source_digest = v.source_digest AND p.kind = 'preview'
        )
      GROUP BY tag.id, tag.label
      ORDER BY tag.label COLLATE NOCASE ASC, tag.id ASC LIMIT 100
    `).all() as Array<{ value: string; count: number }>)
    const statuses = (this.database.prepare(`
      SELECT v.status AS value, count(*) AS count
      FROM template_assets a JOIN template_versions v ON v.id = a.current_version_id AND v.asset_id = a.id
      WHERE a.status = 'active' AND v.status IN ('verified', 'available') AND v.content_object_digest = v.source_digest
        AND EXISTS (
          SELECT 1 FROM template_preview_derivatives p JOIN template_preview_derivatives t
            ON t.template_version_id = p.template_version_id AND t.source_digest = p.source_digest AND t.renderer_version = p.renderer_version AND t.kind = 'thumbnail'
          JOIN content_objects po ON po.digest = p.content_digest AND po.media_type = 'image/png'
          JOIN content_objects tob ON tob.digest = t.content_digest AND tob.media_type = 'image/png'
          WHERE p.template_version_id = v.id AND p.source_digest = v.source_digest AND p.kind = 'preview'
        )
      GROUP BY v.status ORDER BY v.status ASC
    `).all() as Array<{ value: 'verified' | 'available'; count: number }>)

    return { items, facets: { categories, tags, statuses }, total, limit: query.limit, offset: query.offset }
  }

  readDerivative(owner: OwnerContext, assetId: string, kind: 'preview' | 'thumbnail'): Buffer {
    assertOwner(owner)
    assertAssetId(assetId)
    const row = this.database.prepare(`
      SELECT derivative.content_digest, object.media_type, object.byte_size, object.relative_path
      FROM template_assets asset
      JOIN template_versions version ON version.id = asset.current_version_id AND version.asset_id = asset.id
      JOIN template_preview_derivatives derivative
        ON derivative.template_version_id = version.id AND derivative.source_digest = version.source_digest AND derivative.kind = ?
      JOIN content_objects object ON object.digest = derivative.content_digest
      WHERE asset.id = ? AND asset.status = 'active'
        AND version.status IN ('verified', 'available')
        AND version.content_object_digest = version.source_digest
        AND object.media_type = 'image/png'
        AND EXISTS (
          SELECT 1 FROM template_preview_derivatives pair
          JOIN content_objects pair_object ON pair_object.digest = pair.content_digest AND pair_object.media_type = 'image/png'
          WHERE pair.template_version_id = version.id
            AND pair.source_digest = version.source_digest
            AND pair.renderer_version = derivative.renderer_version
            AND pair.kind = CASE WHEN derivative.kind = 'preview' THEN 'thumbnail' ELSE 'preview' END
        )
      ORDER BY derivative.created_at DESC, derivative.renderer_version DESC
      LIMIT 1
    `).get(kind, assetId) as DerivativeRow | undefined
    if (!row) throw new CatalogRequestError('Verified PNG derivative not found', 404)
    if (row.media_type !== 'image/png' || row.relative_path !== this.contentStore.relativePathFor(row.content_digest)) {
      throw new CatalogRequestError('Registered derivative metadata is invalid', 409)
    }
    let content: Buffer
    try {
      content = this.contentStore.read(row.content_digest)
    } catch {
      throw new CatalogRequestError('Registered derivative integrity check failed', 409)
    }
    if (content.byteLength !== row.byte_size) throw new CatalogRequestError('Registered derivative size check failed', 409)
    assertPng(content, kind)
    return content
  }

  readRuntime(owner: OwnerContext, assetId: string): CompiledCatalogRuntime {
    assertOwner(owner)
    assertAssetId(assetId)
    const row = this.database.prepare(`
      SELECT asset.id AS asset_id, version.version_number, version.contract_version, version.source_digest,
        object.digest AS content_digest, object.media_type, object.byte_size, object.relative_path
      FROM template_assets asset
      JOIN template_versions version
        ON version.id = asset.current_version_id AND version.asset_id = asset.id
      JOIN content_objects object ON object.digest = version.content_object_digest
      WHERE asset.id = ?
        AND asset.status = 'active'
        AND version.status IN ('verified', 'available')
        AND version.contract_version IN (?, ?)
        AND version.content_object_digest = version.source_digest
      LIMIT 1
    `).get(assetId, TEMPLATE_PACKAGE_CONTRACT_VERSION, INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION) as RuntimeRow | undefined
    if (!row || (row.contract_version === INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION && !isAllowlistedInteractiveTemplateDigest(row.source_digest))) throw new CatalogRequestError('Template runtime not found', 404)
    if (row.content_digest !== row.source_digest
      || row.media_type !== 'application/vnd.html-template-package+json'
      || row.relative_path !== this.contentStore.relativePathFor(row.content_digest)) {
      throw new CatalogRequestError('Template runtime content metadata is invalid', 409)
    }

    let content: Buffer
    try { content = this.contentStore.read(row.content_digest) }
    catch { throw new CatalogRequestError('Template runtime content integrity check failed', 409) }
    if (content.byteLength !== row.byte_size) throw new CatalogRequestError('Template runtime content size check failed', 409)

    let source: TemplatePackageSource
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(content)
      const value = JSON.parse(text) as unknown
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid root')
      const record = value as Record<string, unknown>
      if (Object.keys(record).sort().join(',') !== 'files,manifest'
        || !record.manifest || typeof record.manifest !== 'object' || Array.isArray(record.manifest)
        || !record.files || typeof record.files !== 'object' || Array.isArray(record.files)) throw new Error('invalid package shape')
      source = value as TemplatePackageSource
    } catch {
      throw new CatalogRequestError('Template runtime package is invalid', 409)
    }

    try {
      if (row.contract_version === TEMPLATE_PACKAGE_CONTRACT_VERSION) {
        return compileStaticTemplateRuntime(source, { sourceDigest: row.source_digest, assetId: row.asset_id, version: row.version_number })
      }
      return { mode: 'sandboxed-js', ...compileInteractiveTemplateRuntime(source, {
        expectedSourceDigest: row.source_digest, expectedAssetId: row.asset_id, expectedVersion: row.version_number,
      }) }
    } catch (error) {
      if (error instanceof InteractiveTemplateRuntimeError || error instanceof StaticTemplateRuntimeError) throw new CatalogRequestError('Template runtime package verification failed', 409)
      throw error
    }
  }

  retire(assetId: string): RetiredTemplate {
    return new AssetCatalogRepository(this.database, this.contentStore).retire(assetId)
  }
}
