import { createHash } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import { AuditEventWriter } from '../auth/audit.js'
import { serializeTemplatePackage, type SimulatedTemplateAdapterResult } from '../templates/simulated-adapter.js'
import { LocalContentStore, type StoredContentObject } from './content-store.js'

type Database = BetterSqlite3.Database

const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type RegisteredTemplate = Readonly<{
  assetId: string
  versionId: string
  sourceDigest: string
  contentObject: StoredContentObject
  created: boolean
}>

export type RegisterTemplateOptions = Readonly<{
  promote?: boolean
}>

export type RetiredTemplate = Readonly<{
  assetId: string
  status: 'retired'
  alreadyRetired: boolean
}>

export class TemplateRetireError extends Error {
  constructor(readonly status: 400 | 404, message: string) {
    super(message)
  }
}

function tagId(label: string): string {
  return `tag-${createHash('sha256').update(label, 'utf8').digest('hex')}`
}

function sameJson(left: string, right: unknown): boolean {
  return left === JSON.stringify(right)
}

export class AssetCatalogRepository {
  constructor(private readonly database: Database, private readonly contentStore: LocalContentStore) {}

  registerTemplate(template: SimulatedTemplateAdapterResult, options: RegisterTemplateOptions = {}): RegisteredTemplate {
    const promote = options.promote ?? true
    const contentObject = this.contentStore.put(serializeTemplatePackage(template.source), 'application/vnd.html-template-package+json')
    if (contentObject.digest !== template.version.sourceDigest) throw new Error('CAS digest does not match P03 source digest')

    return this.database.transaction(() => {
      const existingObject = this.database.prepare('SELECT media_type, byte_size, relative_path FROM content_objects WHERE digest = ?').get(contentObject.digest) as { media_type: string; byte_size: number; relative_path: string } | undefined
      if (existingObject) {
        if (existingObject.media_type !== contentObject.mediaType || existingObject.byte_size !== contentObject.byteSize || existingObject.relative_path !== contentObject.relativePath) throw new Error('Existing content object metadata conflicts with verified CAS object')
      } else {
        this.database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(contentObject.digest, contentObject.mediaType, contentObject.byteSize, contentObject.relativePath, Date.now())
      }

      const now = Date.now()
      const asset = this.database.prepare('SELECT title, summary, category, current_version_id FROM template_assets WHERE id = ?').get(template.asset.id) as { title: string; summary: string; category: string; current_version_id: string | null } | undefined
      if (asset) {
        if (asset.title !== template.asset.title || asset.summary !== template.asset.summary || asset.category !== template.asset.category) throw new Error('Existing template asset metadata is immutable for idempotent registration')
      } else {
        this.database.prepare('INSERT INTO template_assets (id, title, summary, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(template.asset.id, template.asset.title, template.asset.summary, template.asset.category, now, now)
      }

      const version = this.database.prepare('SELECT asset_id, version_number, contract_version, source_digest, content_object_digest, slot_schema, status FROM template_versions WHERE id = ?').get(template.version.id) as { asset_id: string; version_number: number; contract_version: string; source_digest: string; content_object_digest: string | null; slot_schema: string; status: string } | undefined
      if (version) {
        const matches = version.asset_id === template.version.assetId
          && version.version_number === template.version.versionNumber
          && version.contract_version === template.version.contractVersion
          && version.source_digest === template.version.sourceDigest
          && version.content_object_digest === contentObject.digest
          && sameJson(version.slot_schema, template.version.slotSchema)
          && version.status === 'verified'
        if (!matches) throw new Error('Template version id conflicts with immutable catalog content')
        if (promote) this.promoteNewestVersion(template.version.id, template.version.versionNumber, now)
        return { assetId: template.asset.id, versionId: template.version.id, sourceDigest: template.version.sourceDigest, contentObject, created: false }
      }

      const newest = this.database.prepare('SELECT max(version_number) AS version_number FROM template_versions WHERE asset_id = ?').get(template.asset.id) as { version_number: number | null }
      if (newest.version_number !== null && template.version.versionNumber <= newest.version_number) throw new Error('Template version numbers must append in ascending order')
      this.database.prepare("INSERT INTO template_versions (id, asset_id, version_number, contract_version, source_digest, content_object_digest, slot_schema, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', ?)").run(template.version.id, template.version.assetId, template.version.versionNumber, template.version.contractVersion, template.version.sourceDigest, contentObject.digest, JSON.stringify(template.version.slotSchema), now)
      for (const label of template.asset.tags) {
        const id = tagId(label)
        this.database.prepare('INSERT OR IGNORE INTO tags (id, label, created_at) VALUES (?, ?, ?)').run(id, label, now)
        this.database.prepare('INSERT OR IGNORE INTO template_asset_tags (asset_id, tag_id) VALUES (?, ?)').run(template.asset.id, id)
      }
      if (promote) this.promoteNewestVersion(template.version.id, template.version.versionNumber, now)
      return { assetId: template.asset.id, versionId: template.version.id, sourceDigest: template.version.sourceDigest, contentObject, created: true }
    })()
  }

  retire(assetId: string): RetiredTemplate {
    if (!ASSET_ID.test(assetId)) throw new TemplateRetireError(400, 'Template asset id is invalid')
    return this.database.transaction(() => {
      const asset = this.database.prepare('SELECT status FROM template_assets WHERE id = ?').get(assetId) as { status: 'active' | 'retired' } | undefined
      if (!asset) throw new TemplateRetireError(404, 'Template asset not found')
      const alreadyRetired = asset.status === 'retired'
      if (!alreadyRetired) {
        this.database.prepare("UPDATE template_assets SET status = 'retired', updated_at = ? WHERE id = ? AND status = 'active'").run(Date.now(), assetId)
      }
      new AuditEventWriter(this.database).record({
        action: 'admin.template_retire',
        entityType: 'template_asset',
        entityId: assetId,
        result: 'success',
        diagnostic: alreadyRetired ? 'ALREADY_RETIRED' : 'TEMPLATE_RETIRED',
      })
      return { assetId, status: 'retired' as const, alreadyRetired }
    })()
  }

  private promoteNewestVersion(versionId: string, versionNumber: number, now: number): void {
    this.database.prepare(`
      UPDATE template_assets
      SET current_version_id = ?, updated_at = ?
      WHERE id = (SELECT asset_id FROM template_versions WHERE id = ?)
        AND current_version_id IS NOT ?
        AND (
          current_version_id IS NULL
          OR EXISTS (
            SELECT 1 FROM template_versions current
            WHERE current.id = template_assets.current_version_id
              AND current.version_number < ?
          )
        )
    `).run(versionId, now, versionId, versionId, versionNumber)
  }
}
