import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import type { OwnerContext } from '../owner.js'

type Database = BetterSqlite3.Database

const MAX_NAME_LENGTH = 120
const MAX_OVERRIDES_BYTES = 8_192
const POSITION_OFFSET = 1_000_000
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class PresentationRequestError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message)
  }
}

export type PresentationItem = Readonly<{
  id: string
  templateVersionId: string
  position: number
  slotOverrides: Record<string, string>
  template: { title: string; versionNumber: number }
}>

export type Presentation = Readonly<{
  id: string
  name: string
  revision: number
  createdAt: number
  updatedAt: number
  items: PresentationItem[]
}>

type Slot = { id: string; type: 'text' | 'color'; maxLength?: number }
type VersionRow = { id: string; slot_schema: string }

function assertOwner(owner: OwnerContext): void {
  if (owner.id !== 'local-owner' || owner.kind !== 'local') throw new PresentationRequestError('Fixed local OwnerContext required', 404)
}

function assertId(value: string, label: string): void {
  if (value.length > 120 || !ID.test(value)) throw new PresentationRequestError(`${label} is invalid`)
}

function assertExpectedRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > Number.MAX_SAFE_INTEGER) {
    throw new PresentationRequestError('expectedRevision must be a non-negative integer')
  }
  return value as number
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') throw new PresentationRequestError('Presentation name must be a string')
  const name = value.trim()
  if (!name || name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) throw new PresentationRequestError('Presentation name is invalid')
  return name
}

function parseSlotSchema(value: string): Slot[] {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new PresentationRequestError('Template slot schema is invalid', 409) }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { slots?: unknown }).slots)) {
    throw new PresentationRequestError('Template slot schema is invalid', 409)
  }
  const slots = (parsed as { slots: unknown[] }).slots
  if (slots.length > 100) throw new PresentationRequestError('Template slot schema is invalid', 409)
  const result = slots.map((slot) => {
    if (!slot || typeof slot !== 'object') throw new PresentationRequestError('Template slot schema is invalid', 409)
    const candidate = slot as Partial<Slot>
    if (typeof candidate.id !== 'string' || !['text', 'color'].includes(candidate.type ?? '') || (candidate.maxLength !== undefined && (!Number.isInteger(candidate.maxLength) || candidate.maxLength < 1 || candidate.maxLength > 2_000))) {
      throw new PresentationRequestError('Template slot schema is invalid', 409)
    }
    return { id: candidate.id, type: candidate.type as 'text' | 'color', maxLength: candidate.maxLength }
  })
  if (new Set(result.map((slot) => slot.id)).size !== result.length) throw new PresentationRequestError('Template slot schema is invalid', 409)
  return result
}

function normalizeOverrides(value: unknown, slots: Slot[]): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PresentationRequestError('slotOverrides must be a JSON object')
  const serialized = JSON.stringify(value)
  if (serialized.length > MAX_OVERRIDES_BYTES) throw new PresentationRequestError('slotOverrides is too large')
  const known = new Map(slots.map((slot) => [slot.id, slot]))
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const slot = known.get(key)
    if (!slot) throw new PresentationRequestError('slotOverrides contains an undeclared slot')
    if (typeof raw !== 'string' || raw.length > (slot.maxLength ?? 500) || /[\u0000-\u001f\u007f<>]/.test(raw)) throw new PresentationRequestError(`slotOverrides.${key} is invalid`)
    if (slot.type === 'color') {
      if (!/^#[0-9a-f]{6}$/i.test(raw)) throw new PresentationRequestError(`slotOverrides.${key} must be a hex color`)
    } else if (/\b(?:javascript|data|file|https?):|\/\/|\\|\.\./i.test(raw)) {
      throw new PresentationRequestError(`slotOverrides.${key} contains a forbidden executable or path value`)
    }
    result[key] = raw
  }
  return result
}

function parseOverrides(value: string): Record<string, string> {
  try { return JSON.parse(value) as Record<string, string> } catch { throw new PresentationRequestError('Stored slot overrides are invalid', 409) }
}

export class PresentationRepository {
  constructor(private readonly database: Database) {}

  list(owner: OwnerContext): Presentation[] {
    assertOwner(owner)
    return (this.database.prepare('SELECT id FROM presentations ORDER BY updated_at DESC, id ASC LIMIT 100').all() as { id: string }[]).map((row) => this.read(owner, row.id))
  }

  read(owner: OwnerContext, id: string): Presentation {
    assertOwner(owner)
    assertId(id, 'Presentation id')
    const presentation = this.database.prepare('SELECT id, name, revision, created_at, updated_at FROM presentations WHERE id = ?').get(id) as { id: string; name: string; revision: number; created_at: number; updated_at: number } | undefined
    if (!presentation) throw new PresentationRequestError('Presentation not found', 404)
    const items = this.database.prepare(`
      SELECT item.id, item.template_version_id, item.position, item.slot_overrides, asset.title, version.version_number
      FROM presentation_items item
      JOIN template_versions version ON version.id = item.template_version_id
      JOIN template_assets asset ON asset.id = version.asset_id
      WHERE item.presentation_id = ? ORDER BY item.position ASC, item.id ASC
    `).all(id) as { id: string; template_version_id: string; position: number; slot_overrides: string; title: string; version_number: number }[]
    return {
      id: presentation.id, name: presentation.name, revision: presentation.revision, createdAt: presentation.created_at, updatedAt: presentation.updated_at,
      items: items.map((item) => ({ id: item.id, templateVersionId: item.template_version_id, position: item.position, slotOverrides: parseOverrides(item.slot_overrides), template: { title: item.title, versionNumber: item.version_number } })),
    }
  }

  create(owner: OwnerContext, name: unknown): Presentation {
    assertOwner(owner)
    const normalized = normalizeName(name)
    const now = Date.now()
    const id = `presentation-${randomUUID()}`
    this.database.prepare('INSERT INTO presentations (id, name, revision, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(id, normalized, now, now)
    return this.read(owner, id)
  }

  rename(owner: OwnerContext, id: string, name: unknown, expectedRevision: unknown): Presentation {
    return this.mutate(owner, id, expectedRevision, () => {
      this.database.prepare('UPDATE presentations SET name = ? WHERE id = ?').run(normalizeName(name), id)
    })
  }

  add(owner: OwnerContext, id: string, templateVersionId: unknown, expectedRevision: unknown, position?: unknown): Presentation {
    if (typeof templateVersionId !== 'string') throw new PresentationRequestError('templateVersionId must be a string')
    assertId(templateVersionId, 'Template version id')
    return this.mutate(owner, id, expectedRevision, () => {
      const version = this.database.prepare(`
        SELECT version.id, version.slot_schema
        FROM template_versions version JOIN template_assets asset ON asset.id = version.asset_id
        WHERE version.id = ? AND asset.current_version_id = version.id AND asset.status = 'active'
          AND version.status IN ('verified', 'available') AND version.content_object_digest = version.source_digest
          AND EXISTS (SELECT 1 FROM template_preview_derivatives preview JOIN template_preview_derivatives thumbnail
            ON thumbnail.template_version_id = preview.template_version_id AND thumbnail.source_digest = preview.source_digest
              AND thumbnail.renderer_version = preview.renderer_version AND thumbnail.kind = 'thumbnail'
            JOIN content_objects preview_object ON preview_object.digest = preview.content_digest AND preview_object.media_type = 'image/png'
            JOIN content_objects thumbnail_object ON thumbnail_object.digest = thumbnail.content_digest AND thumbnail_object.media_type = 'image/png'
            WHERE preview.template_version_id = version.id AND preview.source_digest = version.source_digest AND preview.kind = 'preview')
      `).get(templateVersionId) as VersionRow | undefined
      if (!version) throw new PresentationRequestError('Template version is not an active catalog selection', 409)
      const count = (this.database.prepare('SELECT count(*) AS count FROM presentation_items WHERE presentation_id = ?').get(id) as { count: number }).count
      const target = position === undefined ? count : this.position(position, count, true)
      this.shiftAndRewrite(id, (items) => [...items.slice(0, target), { id: `item-${randomUUID()}`, versionId: version.id, overrides: '{}' }, ...items.slice(target)])
    })
  }

  copy(owner: OwnerContext, id: string, itemId: string, expectedRevision: unknown, position?: unknown): Presentation {
    assertId(itemId, 'Presentation item id')
    return this.mutate(owner, id, expectedRevision, () => {
      const source = this.database.prepare('SELECT template_version_id, slot_overrides FROM presentation_items WHERE id = ? AND presentation_id = ?').get(itemId, id) as { template_version_id: string; slot_overrides: string } | undefined
      if (!source) throw new PresentationRequestError('Presentation item not found', 404)
      const count = (this.database.prepare('SELECT count(*) AS count FROM presentation_items WHERE presentation_id = ?').get(id) as { count: number }).count
      const target = position === undefined ? count : this.position(position, count, true)
      this.shiftAndRewrite(id, (items) => [...items.slice(0, target), { id: `item-${randomUUID()}`, versionId: source.template_version_id, overrides: source.slot_overrides }, ...items.slice(target)])
    })
  }

  remove(owner: OwnerContext, id: string, itemId: string, expectedRevision: unknown): Presentation {
    assertId(itemId, 'Presentation item id')
    return this.mutate(owner, id, expectedRevision, () => {
      const items = this.items(id)
      if (!items.some((item) => item.id === itemId)) throw new PresentationRequestError('Presentation item not found', 404)
      this.shiftAndRewrite(id, (current) => current.filter((item) => item.id !== itemId))
    })
  }

  move(owner: OwnerContext, id: string, itemId: string, position: unknown, expectedRevision: unknown): Presentation {
    assertId(itemId, 'Presentation item id')
    return this.mutate(owner, id, expectedRevision, () => {
      const items = this.items(id)
      const currentIndex = items.findIndex((item) => item.id === itemId)
      if (currentIndex < 0) throw new PresentationRequestError('Presentation item not found', 404)
      const target = this.position(position, items.length - 1, false)
      const [item] = items.splice(currentIndex, 1)
      items.splice(target, 0, item)
      this.shiftAndRewrite(id, () => items)
    })
  }

  reviseOverrides(owner: OwnerContext, id: string, itemId: string, slotOverrides: unknown, expectedRevision: unknown): Presentation {
    assertId(itemId, 'Presentation item id')
    return this.mutate(owner, id, expectedRevision, () => {
      const item = this.database.prepare(`SELECT item.template_version_id, version.slot_schema FROM presentation_items item JOIN template_versions version ON version.id = item.template_version_id WHERE item.id = ? AND item.presentation_id = ?`).get(itemId, id) as { template_version_id: string; slot_schema: string } | undefined
      if (!item) throw new PresentationRequestError('Presentation item not found', 404)
      const overrides = normalizeOverrides(slotOverrides, parseSlotSchema(item.slot_schema))
      this.database.prepare('UPDATE presentation_items SET slot_overrides = ?, updated_at = ? WHERE id = ? AND presentation_id = ?').run(JSON.stringify(overrides), Date.now(), itemId, id)
    })
  }

  private position(value: unknown, max: number, inserting: boolean): number {
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > max) throw new PresentationRequestError(`position must be an integer between 0 and ${max}`)
    if (inserting && (value as number) > max) throw new PresentationRequestError(`position must be an integer between 0 and ${max}`)
    return value as number
  }

  private items(id: string): Array<{ id: string; versionId: string; overrides: string }> {
    return this.database.prepare('SELECT id, template_version_id, slot_overrides FROM presentation_items WHERE presentation_id = ? ORDER BY position ASC, id ASC').all(id).map((row) => ({ id: (row as { id: string }).id, versionId: (row as { template_version_id: string }).template_version_id, overrides: (row as { slot_overrides: string }).slot_overrides }))
  }

  private shiftAndRewrite(id: string, rewrite: (items: Array<{ id: string; versionId: string; overrides: string }>) => Array<{ id: string; versionId: string; overrides: string }>): void {
    const next = rewrite(this.items(id))
    this.database.prepare('UPDATE presentation_items SET position = position + ? WHERE presentation_id = ?').run(POSITION_OFFSET, id)
    this.database.prepare('DELETE FROM presentation_items WHERE presentation_id = ?').run(id)
    const insert = this.database.prepare('INSERT INTO presentation_items (id, presentation_id, template_version_id, position, slot_overrides, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const now = Date.now()
    next.forEach((item, position) => insert.run(item.id, id, item.versionId, position, item.overrides, now, now))
  }

  private mutate(owner: OwnerContext, id: string, expectedRevision: unknown, operation: () => void): Presentation {
    assertOwner(owner)
    assertId(id, 'Presentation id')
    const expected = assertExpectedRevision(expectedRevision)
    const transaction = this.database.transaction(() => {
      const row = this.database.prepare('SELECT revision FROM presentations WHERE id = ?').get(id) as { revision: number } | undefined
      if (!row) throw new PresentationRequestError('Presentation not found', 404)
      if (row.revision !== expected) throw new PresentationRequestError('Presentation has changed; reload and retry', 409)
      operation()
      const changed = this.database.prepare('UPDATE presentations SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?').run(Date.now(), id, expected).changes
      if (changed !== 1) throw new PresentationRequestError('Presentation has changed; reload and retry', 409)
    })
    transaction()
    return this.read(owner, id)
  }
}
