import type BetterSqlite3 from 'better-sqlite3'
import type { OwnerContext } from '../owner.js'
import { LocalContentStore } from './content-store.js'

type Database = BetterSqlite3.Database

const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SEARCH_LENGTH = 100
const MAX_FILTER_LENGTH = 80
const MAX_TAGS = 5
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 48

export class CatalogRequestError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message)
  }
}

export type CatalogQuery = Readonly<{
  search: string
  category: string | null
  tags: string[]
  limit: number
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
  }
  derivative: {
    rendererVersion: string
    previewUrl: string
    thumbnailUrl: string
    createdAt: number
  }
}>

export type CatalogResponse = Readonly<{
  owner: 'local-owner'
  items: CatalogItem[]
  facets: { categories: string[]; tags: string[] }
  total: number
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

function assertOwner(owner: OwnerContext): void {
  if (owner.id !== 'local-owner' || owner.kind !== 'local') throw new CatalogRequestError('Fixed local OwnerContext required', 404)
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
  const allowed = new Set(['search', 'category', 'tags', 'limit'])
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

  const rawLimit = parameters.get('limit')
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new CatalogRequestError(`limit must be an integer between 1 and ${MAX_LIMIT}`)
  return { search, category, tags, limit }
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
    for (const tag of query.tags) {
      clauses.push('EXISTS (SELECT 1 FROM template_asset_tags filter_at JOIN tags filter_t ON filter_t.id = filter_at.tag_id WHERE filter_at.asset_id = a.id AND filter_t.label = ?)')
      parameters.push(tag)
    }

    const rows = this.database.prepare(`
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
        AND preview.renderer_version = (
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
      ORDER BY a.title COLLATE NOCASE ASC, a.id ASC
      LIMIT ?
    `).all(...parameters, query.limit) as AssetRow[]

    const items = rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      category: row.category,
      tags: (this.database.prepare('SELECT t.label FROM template_asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = ? ORDER BY t.label COLLATE NOCASE ASC, t.id ASC LIMIT 100').all(row.id) as { label: string }[]).map(({ label }) => label),
      version: { id: row.version_id, number: row.version_number, status: row.version_status, contractVersion: row.contract_version },
      derivative: {
        rendererVersion: row.renderer_version,
        previewUrl: `/api/catalog/assets/${encodeURIComponent(row.id)}/preview`,
        thumbnailUrl: `/api/catalog/assets/${encodeURIComponent(row.id)}/thumbnail`,
        createdAt: row.derivative_created_at,
      },
    }))

    const categories = (this.database.prepare(`
      SELECT DISTINCT a.category
      FROM template_assets a JOIN template_versions v ON v.id = a.current_version_id AND v.asset_id = a.id
      WHERE a.status = 'active' AND v.status IN ('verified', 'available') AND v.content_object_digest = v.source_digest
        AND EXISTS (
          SELECT 1 FROM template_preview_derivatives p JOIN template_preview_derivatives t
            ON t.template_version_id = p.template_version_id AND t.source_digest = p.source_digest AND t.renderer_version = p.renderer_version AND t.kind = 'thumbnail'
          JOIN content_objects po ON po.digest = p.content_digest AND po.media_type = 'image/png'
          JOIN content_objects tob ON tob.digest = t.content_digest AND tob.media_type = 'image/png'
          WHERE p.template_version_id = v.id AND p.source_digest = v.source_digest AND p.kind = 'preview'
        )
      ORDER BY a.category COLLATE NOCASE ASC LIMIT 100
    `).all() as { category: string }[]).map(({ category }) => category)
    const tags = (this.database.prepare(`
      SELECT DISTINCT tag.label
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
      ORDER BY tag.label COLLATE NOCASE ASC, tag.id ASC LIMIT 100
    `).all() as { label: string }[]).map(({ label }) => label)

    return { owner: 'local-owner', items, facets: { categories, tags }, total: items.length }
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
}
