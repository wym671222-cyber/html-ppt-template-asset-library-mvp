import { createHash } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import { serializeTemplatePackage, type SimulatedTemplateAdapterResult } from '../templates/simulated-adapter.js'
import { LocalContentStore, type StoredContentObject } from './content-store.js'

type Database = BetterSqlite3.Database

export type RegisteredTemplate = Readonly<{
  assetId: string
  versionId: string
  sourceDigest: string
  contentObject: StoredContentObject
  created: boolean
}>

function tagId(label: string): string {
  return `tag-${createHash('sha256').update(label, 'utf8').digest('hex')}`
}

function sameJson(left: string, right: unknown): boolean {
  return left === JSON.stringify(right)
}

export class AssetCatalogRepository {
  constructor(private readonly database: Database, private readonly contentStore: LocalContentStore) {}

  registerTemplate(template: SimulatedTemplateAdapterResult): RegisteredTemplate {
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
        if (!asset?.current_version_id) throw new Error('Existing template asset has no immutable current version')
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
      this.database.prepare('UPDATE template_assets SET current_version_id = ?, updated_at = ? WHERE id = ?').run(template.version.id, now, template.asset.id)
      return { assetId: template.asset.id, versionId: template.version.id, sourceDigest: template.version.sourceDigest, contentObject, created: true }
    })()
  }
}
