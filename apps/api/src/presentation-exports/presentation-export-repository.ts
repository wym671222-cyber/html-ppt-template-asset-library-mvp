import type BetterSqlite3 from 'better-sqlite3'
import type { OwnerContext } from '../owner.js'
import { LocalContentStore, type StoredContentObject } from '../assets/content-store.js'
import { assertSafeExportPath, createStoredZip, readStoredZip, sha256 } from './offline-archive.js'

type Database = BetterSqlite3.Database

const EXPORT_CONTRACT = 'html-presentation-export/v1' as const
const PACKAGE_CONTRACT = 'html-presentation-export-package/v1' as const
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SHA256 = /^[0-9a-f]{64}$/
const MAX_ITEMS = 100
const MAX_PACKAGE_BYTES = 1_048_576
const MAX_HTML_BYTES = 10_485_760
const MAX_ZIP_BYTES = 25_165_824
const SAFE_PACKAGE_FILE = /^(?:[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)+$/
const FORBIDDEN_TEMPLATE_HTML = /<(?:script|iframe|frame|object|embed|form|base)\b|<meta\b[^>]*\bhttp-equiv\s*=|\son[a-z][a-z0-9_-]*\s*=|\b(?:srcdoc|srcset|target|action|formaction|download)\s*=/i
const TEMPLATE_REFERENCE = /\b(?:src|href|poster)\s*=\s*(["'])(.*?)\1/gi

type TemplateSlotDefinition = { id: string; type: 'text' | 'color'; required: boolean; maxLength?: number; default?: string }
type TemplatePackageSource = {
  manifest: {
    contractVersion: string
    id: string
    version: number
    title: string
    entry: string
    files: string[]
    slots: TemplateSlotDefinition[]
  }
  files: Readonly<Record<string, string>>
}

export class ExportRequestError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message.slice(0, 300))
  }
}

export type ExportFileManifest = Readonly<{
  relativePath: string
  mediaType: string
  byteSize: number
  sha256: string
}>

export type ExportItemManifest = Readonly<{
  itemId: string
  position: number
  templateVersionId: string
  template: {
    assetId: string
    title: string
    versionNumber: number
    contractVersion: string
  }
  source: { sourceSha256: string; contentObjectSha256: string }
  slotOverrides: Record<string, string>
  verifiedDerivatives: { rendererVersion: string; previewSha256: string; thumbnailSha256: string }
}>

export type PresentationExportManifest = Readonly<{
  contractVersion: typeof EXPORT_CONTRACT
  exportId: string
  owner: 'local-owner'
  createdAt: number
  presentation: { id: string; name: string; revision: number }
  items: ExportItemManifest[]
  package: {
    entry: 'index.html'
    embeddedManifest: 'manifest.json'
    files: ExportFileManifest[]
    htmlSha256: string
    zipSha256: string
    zipByteSize: number
  }
}>

export type PresentationExportSummary = Readonly<{
  id: string
  presentationId: string
  presentationRevision: number
  createdAt: number
  itemCount: number
  manifestUrl: string
  htmlUrl: string
  zipUrl: string
}>

type SourceObjectRow = {
  item_id: string
  position: number
  slot_overrides: string
  template_version_id: string
  asset_id: string
  title: string
  version_number: number
  contract_version: string
  source_digest: string
  content_object_digest: string | null
  slot_schema: string
  version_status: string
  source_media_type: string | null
  source_byte_size: number | null
  source_relative_path: string | null
}

type DerivativeRow = {
  renderer_version: string
  preview_digest: string
  preview_media_type: string
  preview_byte_size: number
  preview_relative_path: string
  thumbnail_digest: string
  thumbnail_media_type: string
  thumbnail_byte_size: number
  thumbnail_relative_path: string
}

type SnapshotItem = ExportItemManifest & Readonly<{
  source: ExportItemManifest['source'] & { package: TemplatePackageSource }
  thumbnail: Buffer
}>

type ExportSnapshot = Readonly<{
  presentation: { id: string; name: string; revision: number }
  items: SnapshotItem[]
}>

type ExportRow = {
  id: string
  presentation_id: string
  presentation_revision: number
  manifest_digest: string
  html_digest: string
  zip_digest: string
  created_at: number
  manifest_media_type: string
  manifest_byte_size: number
  manifest_relative_path: string
  html_media_type: string
  html_byte_size: number
  html_relative_path: string
  zip_media_type: string
  zip_byte_size: number
  zip_relative_path: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertOwner(owner: OwnerContext): void {
  if (owner.id !== 'local-owner' || owner.kind !== 'local') throw new ExportRequestError('Fixed local OwnerContext required', 404)
}

function assertId(value: string, label: string): void {
  if (value.length > 120 || !ID.test(value)) throw new ExportRequestError(`${label} is invalid`)
}

function expectedRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > Number.MAX_SAFE_INTEGER) throw new ExportRequestError('expectedRevision must be a non-negative integer')
  return value as number
}

function expectedItemIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ITEMS) throw new ExportRequestError(`itemIds must contain between 1 and ${MAX_ITEMS} items`)
  const ids = value.map((item) => {
    if (typeof item !== 'string') throw new ExportRequestError('itemIds must contain only item ids')
    assertId(item, 'Presentation item id')
    return item
  })
  if (new Set(ids).size !== ids.length) throw new ExportRequestError('itemIds must not contain duplicates')
  return ids
}

function parseOverrides(value: string, slots: readonly TemplateSlotDefinition[]): Record<string, string> {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new ExportRequestError('Stored slot overrides are invalid', 409) }
  if (!isRecord(parsed) || JSON.stringify(parsed).length > 8_192) throw new ExportRequestError('Stored slot overrides are invalid', 409)
  const known = new Map(slots.map((slot) => [slot.id, slot]))
  const result: Record<string, string> = {}
  for (const key of Object.keys(parsed).sort()) {
    const slot = known.get(key)
    const raw = parsed[key]
    if (!slot || typeof raw !== 'string' || raw.length > (slot.maxLength ?? 500) || /[\u0000-\u001f\u007f<>]/.test(raw)) throw new ExportRequestError('Stored slot overrides violate the fixed TemplateVersion schema', 409)
    if (slot.type === 'color' ? !/^#[0-9a-f]{6}$/i.test(raw) : /\b(?:javascript|data|file|https?):|\/\/|\\|\.\./i.test(raw)) {
      throw new ExportRequestError('Stored slot overrides contain a forbidden executable or path value', 409)
    }
    result[key] = raw
  }
  return result
}

function assertSafeStoredPackage(source: TemplatePackageSource): void {
  const { manifest, files } = source
  if (manifest.contractVersion !== 'html-template/v1' || !ID.test(manifest.id) || !Number.isInteger(manifest.version) || manifest.version < 1 || manifest.entry !== 'index.html') throw new ExportRequestError('Verified template package identity is invalid', 409)
  if (!Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 100 || new Set(manifest.files).size !== manifest.files.length || !manifest.files.includes(manifest.entry)) throw new ExportRequestError('Verified template package file manifest is invalid', 409)
  if (!Array.isArray(manifest.slots) || manifest.slots.length > 100 || new Set(manifest.slots.map((slot) => slot.id)).size !== manifest.slots.length) throw new ExportRequestError('Verified template package slot manifest is invalid', 409)
  for (const slot of manifest.slots) {
    if (!isRecord(slot) || typeof slot.id !== 'string' || !ID.test(slot.id) || !['text', 'color'].includes(slot.type) || typeof slot.required !== 'boolean' || (slot.maxLength !== undefined && (!Number.isInteger(slot.maxLength) || slot.maxLength < 1 || slot.maxLength > 2_000)) || (slot.default !== undefined && (typeof slot.default !== 'string' || /[\u0000-\u001f\u007f]/.test(slot.default)))) {
      throw new ExportRequestError('Verified template package slot manifest is invalid', 409)
    }
  }
  const declared = new Set(manifest.files)
  if (Object.keys(files).length !== declared.size || Object.keys(files).some((file) => !declared.has(file))) throw new ExportRequestError('Verified template package contains an undeclared file', 409)
  for (const file of manifest.files) {
    if (!SAFE_PACKAGE_FILE.test(file) || file.includes('..') || !/\.(?:html|css)$/.test(file) || typeof files[file] !== 'string') throw new ExportRequestError('Verified template package contains an unsafe file path', 409)
    const value = files[file]
    if (file.endsWith('.css')) {
      if (/@import\b|\burl\s*\(/i.test(value)) throw new ExportRequestError('Verified template CSS contains a resource fetch', 409)
      continue
    }
    if (FORBIDDEN_TEMPLATE_HTML.test(value) || /\b(?:src|href|poster)\s*=\s*(?!["'])/i.test(value)) throw new ExportRequestError('Verified template HTML contains active content', 409)
    for (const match of value.matchAll(TEMPLATE_REFERENCE)) {
      const reference = match[2].trim().split(/[?#]/, 1)[0]
      if (!reference || reference.startsWith('/') || reference.split('/').includes('..') || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(reference) || !declared.has(reference)) throw new ExportRequestError('Verified template HTML contains an undeclared reference', 409)
    }
  }
}

function serializePackage(source: TemplatePackageSource): Buffer {
  return Buffer.from(JSON.stringify({ manifest: source.manifest, files: Object.fromEntries(Object.entries(source.files).sort(([left], [right]) => left.localeCompare(right))) }), 'utf8')
}

function readPackage(content: Buffer): TemplatePackageSource {
  if (content.byteLength > MAX_PACKAGE_BYTES) throw new ExportRequestError('Verified template package exceeds the export size limit', 409)
  let parsed: unknown
  try { parsed = JSON.parse(content.toString('utf8')) } catch { throw new ExportRequestError('Verified CAS object is not a template package', 409) }
  if (!isRecord(parsed) || !isRecord(parsed.manifest) || !isRecord(parsed.files)) throw new ExportRequestError('Verified CAS template package shape is invalid', 409)
  const source = parsed as unknown as TemplatePackageSource
  assertSafeStoredPackage(source)
  if (!serializePackage(source).equals(content)) throw new ExportRequestError('Verified CAS template package is not canonical', 409)
  return source
}

function assertPng(content: Buffer, width: number, height: number): void {
  if (content.byteLength < 24 || content.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || content.subarray(12, 16).toString('ascii') !== 'IHDR' || content.readUInt32BE(16) !== width || content.readUInt32BE(20) !== height) {
    throw new ExportRequestError('P05 derivative is not the required PNG', 409)
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function scopeCss(css: string, scope: string): string {
  if (/@/.test(css)) throw new ExportRequestError('Template CSS is outside the P08 fixture export profile', 409)
  const rule = /([^{}]+)\{([^{}]*)\}/g
  let cursor = 0
  let output = ''
  for (const match of css.matchAll(rule)) {
    const index = match.index ?? 0
    if (css.slice(cursor, index).trim()) throw new ExportRequestError('Template CSS is malformed', 409)
    const selectors = match[1].split(',').map((selector) => {
      const value = selector.trim()
      if (!value || /@|\b(?:html|body)\s+[>+~]|:has\(/i.test(value)) throw new ExportRequestError('Template CSS selector is outside the P08 fixture export profile', 409)
      if (value === ':root' || value === 'html' || value === 'body') return scope
      if (value.startsWith('body ')) return `${scope} ${value.slice(5)}`
      return `${scope} ${value}`
    })
    output += `${selectors.join(', ')} {${match[2]}}\n`
    cursor = index + match[0].length
  }
  if (css.slice(cursor).trim()) throw new ExportRequestError('Template CSS is malformed', 409)
  return output
}

function renderTemplateBody(item: SnapshotItem): { body: string; css: string } {
  const entry = item.source.package.files[item.source.package.manifest.entry]
  const bodyMatch = entry.match(/<body(?:\s[^>]*)?>([\s\S]*)<\/body\s*>/i)
  if (!bodyMatch || (entry.match(/<body\b/gi)?.length ?? 0) !== 1 || /\b(?:src|href|poster)\s*=/i.test(bodyMatch[1])) {
    throw new ExportRequestError('Template entry is outside the P08 fixture export profile', 409)
  }
  let body = bodyMatch[1]
  for (const slot of item.source.package.manifest.slots) {
    const value = item.slotOverrides[slot.id] ?? slot.default
    if (value === undefined) continue
    const id = escapeRegExp(slot.id)
    if (slot.type === 'text') {
      const pattern = new RegExp(`(<([a-z][a-z0-9-]*)(?=[^>]*\\bdata-template-slot=["']${id}["'])[^>]*>)[\\s\\S]*?(<\\/\\2\\s*>)`, 'gi')
      let count = 0
      body = body.replace(pattern, (_match, opening: string, _tag: string, closing: string) => {
        count += 1
        return `${opening}${escapeHtml(value)}${closing}`
      })
      if (count < 1) throw new ExportRequestError('Template slot binding is missing from the fixed source', 409)
    } else {
      const pattern = new RegExp(`(<[a-z][a-z0-9-]*(?=[^>]*\\bdata-template-slot=["']${id}["'])[^>]*)(>)`, 'gi')
      let count = 0
      body = body.replace(pattern, (_match, opening: string, close: string) => {
        if (/\sstyle\s*=/i.test(opening)) throw new ExportRequestError('Color slot binding cannot merge an existing inline style', 409)
        count += 1
        return `${opening} style="border-top-color:${value};--template-slot-color:${value}"${close}`
      })
      if (count < 1) throw new ExportRequestError('Template slot binding is missing from the fixed source', 409)
    }
  }
  const scope = `.p08-slide[data-slide-position="${item.position}"]`
  const css = item.source.package.manifest.files.filter((file) => file.endsWith('.css')).map((file) => scopeCss(item.source.package.files[file], scope)).join('\n')
  return { body, css }
}

export function assertSafeExportHtml(content: string, allowedResourcePaths: ReadonlySet<string>): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_HTML_BYTES) throw new ExportRequestError('Generated HTML exceeds the export size limit', 409)
  if (/<(?:script|iframe|frame|object|embed|form|base)\b|\son[a-z][a-z0-9_-]*\s*=|\b(?:srcdoc|action|formaction|target|download)\s*=/i.test(content)) throw new ExportRequestError('Generated HTML contains an active or navigational element', 409)
  if (/\b(?:https?|file|data|blob|javascript):|\/\/|@import\b|\burl\s*\(/i.test(content)) throw new ExportRequestError('Generated HTML contains an external or executable reference', 409)
  if (/\b(?:src|href)\s*=\s*(?!["'])/i.test(content)) throw new ExportRequestError('Generated HTML contains an unquoted resource reference', 409)
  for (const match of content.matchAll(/\b(src|href)\s*=\s*(["'])(.*?)\2/gi)) {
    const value = match[3]
    if (match[1].toLowerCase() === 'href' && /^#slide-[0-9]+$/.test(value)) continue
    if (!allowedResourcePaths.has(value)) throw new ExportRequestError('Generated HTML references a file outside the export allowlist', 409)
  }
}

function publicItems(items: readonly SnapshotItem[]): ExportItemManifest[] {
  return items.map((item) => ({
    itemId: item.itemId,
    position: item.position,
    templateVersionId: item.templateVersionId,
    template: item.template,
    source: { sourceSha256: item.source.sourceSha256, contentObjectSha256: item.source.contentObjectSha256 },
    slotOverrides: item.slotOverrides,
    verifiedDerivatives: item.verifiedDerivatives,
  }))
}

function renderHtml(snapshot: ExportSnapshot): { content: Buffer; thumbnails: Array<{ relativePath: string; content: Buffer }> } {
  const thumbnails = snapshot.items.map((item) => ({ relativePath: `assets/slide-${String(item.position + 1).padStart(4, '0')}-thumbnail.png`, content: item.thumbnail }))
  const allowed = new Set<string>()
  const rendered = snapshot.items.map(renderTemplateBody)
  const navigation = snapshot.items.map((item, index) => `<a href="#slide-${index + 1}"><span>${index + 1}</span><strong>${escapeHtml(item.template.title)}</strong></a>`).join('')
  const slides = snapshot.items.map((item, index) => `<section id="slide-${index + 1}" class="p08-slide" data-slide-position="${item.position}" aria-label="Slide ${index + 1}: ${escapeHtml(item.template.title)}">${rendered[index].body}</section>`).join('\n')
  const sourceCss = rendered.map((item) => item.css).join('\n')
  const content = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"><title>${escapeHtml(snapshot.presentation.name)}</title><style>
*{box-sizing:border-box}html{background:#e9eef5;color:#0f172a;font-family:system-ui,sans-serif}body{margin:0}.p08-export-header{padding:1rem 1.25rem;background:#fff;border-bottom:1px solid #cbd5e1}.p08-export-header h1{margin:0;font-size:1.1rem}.p08-export-header p{margin:.35rem 0 0;color:#64748b;font-size:.8rem}.p08-thumbnails{display:flex;gap:.6rem;padding:.75rem 1.25rem;overflow:auto;background:#f8fafc}.p08-thumbnails a{display:flex;align-items:center;gap:.45rem;flex:0 0 auto;padding:.45rem .65rem;border:1px solid #94a3b8;border-radius:.35rem;background:#fff;color:#0f172a;text-decoration:none}.p08-thumbnails span{display:grid;place-items:center;width:1.35rem;height:1.35rem;background:#0f172a;color:#fff;border-radius:999px;font-size:.7rem}.p08-thumbnails strong{font-size:.75rem}.p08-deck{display:grid;gap:1.5rem;padding:1.5rem}.p08-slide{width:min(100%,1280px);min-height:min(720px,70vw);margin:auto;overflow:hidden;background:#fff;box-shadow:0 10px 28px rgba(15,23,42,.12)}@media(max-width:700px){.p08-deck{padding:.75rem}.p08-slide{min-height:56.25vw}}
${sourceCss}</style></head><body><header class="p08-export-header"><h1>${escapeHtml(snapshot.presentation.name)}</h1><p>Revision ${snapshot.presentation.revision} · ${snapshot.items.length} slides · offline export</p></header><nav class="p08-thumbnails" aria-label="Slides">${navigation}</nav><main class="p08-deck">${slides}</main></body></html>
`
  assertSafeExportHtml(content, allowed)
  return { content: Buffer.from(content, 'utf8'), thumbnails }
}

function fileManifest(relativePath: string, mediaType: string, content: Buffer): ExportFileManifest {
  assertSafeExportPath(relativePath)
  return { relativePath, mediaType, byteSize: content.byteLength, sha256: sha256(content) }
}

function exportFingerprint(snapshot: ExportSnapshot): string {
  return sha256(Buffer.from(JSON.stringify({ presentation: snapshot.presentation, items: publicItems(snapshot.items) }), 'utf8'))
}

function summary(manifest: PresentationExportManifest): PresentationExportSummary {
  const root = `/api/presentations/${encodeURIComponent(manifest.presentation.id)}/exports/${encodeURIComponent(manifest.exportId)}`
  return {
    id: manifest.exportId,
    presentationId: manifest.presentation.id,
    presentationRevision: manifest.presentation.revision,
    createdAt: manifest.createdAt,
    itemCount: manifest.items.length,
    manifestUrl: `${root}/manifest`,
    htmlUrl: `${root}/html`,
    zipUrl: `${root}/zip`,
  }
}

function assertStoredManifestShape(manifest: PresentationExportManifest): void {
  if (!ID.test(manifest.presentation.id) || typeof manifest.presentation.name !== 'string' || !Number.isInteger(manifest.presentation.revision) || manifest.presentation.revision < 0 || !Number.isInteger(manifest.createdAt) || manifest.createdAt < 0 || manifest.items.length < 1 || manifest.items.length > MAX_ITEMS) {
    throw new ExportRequestError('Stored export manifest snapshot is invalid', 409)
  }
  manifest.items.forEach((item, index) => {
    if (!item || !ID.test(item.itemId) || !ID.test(item.templateVersionId) || item.position !== index || !isRecord(item.template) || !ID.test(item.template.assetId) || typeof item.template.title !== 'string' || !Number.isInteger(item.template.versionNumber) || item.template.versionNumber < 1 || item.template.contractVersion !== 'html-template/v1') {
      throw new ExportRequestError('Stored export manifest item identity is invalid', 409)
    }
    if (!isRecord(item.source) || !SHA256.test(item.source.sourceSha256) || item.source.contentObjectSha256 !== item.source.sourceSha256 || !isRecord(item.slotOverrides) || JSON.stringify(item.slotOverrides).length > 8_192 || Object.values(item.slotOverrides).some((value) => typeof value !== 'string' || /[\u0000-\u001f\u007f<>]/.test(value))) {
      throw new ExportRequestError('Stored export manifest item content is invalid', 409)
    }
    if (!isRecord(item.verifiedDerivatives) || typeof item.verifiedDerivatives.rendererVersion !== 'string' || !item.verifiedDerivatives.rendererVersion || /[\u0000-\u001f\u007f]/.test(item.verifiedDerivatives.rendererVersion) || !SHA256.test(item.verifiedDerivatives.previewSha256) || !SHA256.test(item.verifiedDerivatives.thumbnailSha256)) {
      throw new ExportRequestError('Stored export manifest derivative identity is invalid', 409)
    }
  })
  if (manifest.exportId !== `export-${sha256(Buffer.from(JSON.stringify({ presentation: manifest.presentation, items: manifest.items }), 'utf8'))}`) throw new ExportRequestError('Stored export manifest fingerprint is invalid', 409)
  if (manifest.package.files.length !== manifest.items.length + 2) throw new ExportRequestError('Stored export file allowlist size is invalid', 409)
  const index = manifest.package.files.find((file) => file.relativePath === 'index.html')
  const embedded = manifest.package.files.find((file) => file.relativePath === 'manifest.json')
  if (!index || index.mediaType !== 'text/html; charset=utf-8' || index.sha256 !== manifest.package.htmlSha256 || !embedded || embedded.mediaType !== 'application/json') throw new ExportRequestError('Stored export primary file manifest is invalid', 409)
  for (const item of manifest.items) {
    const path = `assets/slide-${String(item.position + 1).padStart(4, '0')}-thumbnail.png`
    const thumbnail = manifest.package.files.find((file) => file.relativePath === path)
    if (!thumbnail || thumbnail.mediaType !== 'image/png' || thumbnail.sha256 !== item.verifiedDerivatives.thumbnailSha256) throw new ExportRequestError('Stored export thumbnail manifest is invalid', 409)
  }
}

export class PresentationExportRepository {
  constructor(private readonly database: Database, private readonly contentStore: LocalContentStore) {}

  create(owner: OwnerContext, presentationId: string, revision: unknown, itemIdsValue: unknown): { manifest: PresentationExportManifest; summary: PresentationExportSummary; created: boolean } {
    assertOwner(owner)
    assertId(presentationId, 'Presentation id')
    const requestedRevision = expectedRevision(revision)
    const itemIds = expectedItemIds(itemIdsValue)
    const snapshot = this.database.transaction(() => this.loadSnapshot(presentationId, requestedRevision, itemIds))()
    const fingerprint = exportFingerprint(snapshot)
    const exportId = `export-${fingerprint}`
    const createdAt = Date.now()
    const rendered = renderHtml(snapshot)
    const htmlFile = fileManifest('index.html', 'text/html; charset=utf-8', rendered.content)
    const payloadFiles = [htmlFile, ...rendered.thumbnails.map((file) => fileManifest(file.relativePath, 'image/png', file.content))]
    const packageManifest = {
      contractVersion: PACKAGE_CONTRACT,
      exportId,
      presentation: snapshot.presentation,
      items: publicItems(snapshot.items),
      files: payloadFiles,
    }
    const embeddedManifest = Buffer.from(`${JSON.stringify(packageManifest, null, 2)}\n`, 'utf8')
    const embeddedManifestFile = fileManifest('manifest.json', 'application/json', embeddedManifest)
    const zip = createStoredZip([
      { relativePath: 'index.html', content: rendered.content },
      ...rendered.thumbnails,
      { relativePath: 'manifest.json', content: embeddedManifest },
    ])
    if (zip.byteLength > MAX_ZIP_BYTES) throw new ExportRequestError('Generated ZIP exceeds the export size limit', 409)
    const manifest: PresentationExportManifest = {
      contractVersion: EXPORT_CONTRACT,
      exportId,
      owner: 'local-owner',
      createdAt,
      presentation: snapshot.presentation,
      items: publicItems(snapshot.items),
      package: {
        entry: 'index.html',
        embeddedManifest: 'manifest.json',
        files: [...payloadFiles, embeddedManifestFile],
        htmlSha256: htmlFile.sha256,
        zipSha256: sha256(zip),
        zipByteSize: zip.byteLength,
      },
    }
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    return this.database.transaction(() => {
      const verifiedSnapshot = this.loadSnapshot(presentationId, requestedRevision, itemIds)
      if (exportFingerprint(verifiedSnapshot) !== fingerprint) throw new ExportRequestError('Presentation export snapshot changed; reload and retry', 409)
      const existing = this.findRow(presentationId, exportId)
      if (existing) {
        const existingManifest = this.verifyRow(existing).manifest
        return { manifest: existingManifest, summary: summary(existingManifest), created: false }
      }
      const htmlObject = this.contentStore.put(rendered.content, 'text/html; charset=utf-8')
      const zipObject = this.contentStore.put(zip, 'application/zip')
      const manifestObject = this.contentStore.put(manifestBytes, 'application/vnd.html-presentation-export-manifest+json')
      if (htmlObject.digest !== manifest.package.htmlSha256 || zipObject.digest !== manifest.package.zipSha256) throw new ExportRequestError('Generated export hash verification failed', 409)
      for (const object of [htmlObject, zipObject, manifestObject]) this.registerContentObject(object)
      this.database.prepare(`INSERT INTO presentation_exports (id, presentation_id, presentation_revision, manifest_digest, html_digest, zip_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(exportId, presentationId, requestedRevision, manifestObject.digest, htmlObject.digest, zipObject.digest, createdAt)
      const verified = this.verifyRow(this.findRow(presentationId, exportId)!)
      return { manifest: verified.manifest, summary: summary(verified.manifest), created: true }
    })()
  }

  list(owner: OwnerContext, presentationId: string): PresentationExportSummary[] {
    assertOwner(owner)
    assertId(presentationId, 'Presentation id')
    const presentation = this.database.prepare('SELECT id FROM presentations WHERE id = ?').get(presentationId)
    if (!presentation) throw new ExportRequestError('Presentation not found', 404)
    const rows = this.database.prepare(`${this.rowSelect()} WHERE export.presentation_id = ? ORDER BY export.created_at DESC, export.id ASC LIMIT 100`).all(presentationId) as ExportRow[]
    return rows.map((row) => summary(this.verifyRow(row).manifest))
  }

  readManifest(owner: OwnerContext, presentationId: string, exportId: string): PresentationExportManifest {
    return this.readVerified(owner, presentationId, exportId).manifest
  }

  readArtifact(owner: OwnerContext, presentationId: string, exportId: string, kind: 'html' | 'zip'): Buffer {
    const verified = this.readVerified(owner, presentationId, exportId)
    return kind === 'html' ? verified.html : verified.zip
  }

  private readVerified(owner: OwnerContext, presentationId: string, exportId: string): { manifest: PresentationExportManifest; html: Buffer; zip: Buffer } {
    assertOwner(owner)
    assertId(presentationId, 'Presentation id')
    assertId(exportId, 'Export id')
    const row = this.findRow(presentationId, exportId)
    if (!row) throw new ExportRequestError('Presentation export not found', 404)
    return this.verifyRow(row)
  }

  private loadSnapshot(presentationId: string, revision: number, itemIds: readonly string[]): ExportSnapshot {
    const presentation = this.database.prepare('SELECT id, name, revision FROM presentations WHERE id = ?').get(presentationId) as { id: string; name: string; revision: number } | undefined
    if (!presentation) throw new ExportRequestError('Presentation not found', 404)
    if (presentation.revision !== revision) throw new ExportRequestError('Presentation has changed; reload and retry', 409)
    const rows = this.database.prepare(`
      SELECT item.id AS item_id, item.position, item.slot_overrides,
        version.id AS template_version_id, version.asset_id, asset.title, version.version_number,
        version.contract_version, version.source_digest, version.content_object_digest,
        version.slot_schema, version.status AS version_status,
        source.media_type AS source_media_type, source.byte_size AS source_byte_size, source.relative_path AS source_relative_path
      FROM presentation_items item
      JOIN template_versions version ON version.id = item.template_version_id
      JOIN template_assets asset ON asset.id = version.asset_id
      LEFT JOIN content_objects source ON source.digest = version.content_object_digest
      WHERE item.presentation_id = ? ORDER BY item.position ASC, item.id ASC
    `).all(presentationId) as SourceObjectRow[]
    if (rows.length < 1) throw new ExportRequestError('Presentation has no items to export', 409)
    if (rows.length > MAX_ITEMS) throw new ExportRequestError(`Presentation export is limited to ${MAX_ITEMS} items`, 409)
    if (rows.length !== itemIds.length || rows.some((row, index) => row.item_id !== itemIds[index])) throw new ExportRequestError('itemIds do not match this Presentation revision', 409)

    const items = rows.map((row) => {
      if (!['verified', 'available'].includes(row.version_status) || !row.content_object_digest || row.content_object_digest !== row.source_digest || row.source_media_type !== 'application/vnd.html-template-package+json' || row.source_byte_size === null || !row.source_relative_path) {
        throw new ExportRequestError('Presentation item uses an unavailable TemplateVersion', 409)
      }
      const sourceBytes = this.readObject(row.content_object_digest, row.source_media_type, row.source_byte_size, row.source_relative_path, 'Template source')
      const source = readPackage(sourceBytes)
      if (source.manifest.id !== row.asset_id || source.manifest.version !== row.version_number || source.manifest.contractVersion !== row.contract_version || JSON.stringify({ slots: source.manifest.slots }) !== row.slot_schema) {
        throw new ExportRequestError('Template source does not match its fixed TemplateVersion', 409)
      }
      const derivatives = this.database.prepare(`
        SELECT preview.renderer_version,
          preview.content_digest AS preview_digest, preview_object.media_type AS preview_media_type,
          preview_object.byte_size AS preview_byte_size, preview_object.relative_path AS preview_relative_path,
          thumbnail.content_digest AS thumbnail_digest, thumbnail_object.media_type AS thumbnail_media_type,
          thumbnail_object.byte_size AS thumbnail_byte_size, thumbnail_object.relative_path AS thumbnail_relative_path
        FROM template_preview_derivatives preview
        JOIN template_preview_derivatives thumbnail ON thumbnail.template_version_id = preview.template_version_id
          AND thumbnail.source_digest = preview.source_digest AND thumbnail.renderer_version = preview.renderer_version AND thumbnail.kind = 'thumbnail'
        JOIN content_objects preview_object ON preview_object.digest = preview.content_digest
        JOIN content_objects thumbnail_object ON thumbnail_object.digest = thumbnail.content_digest
        WHERE preview.template_version_id = ? AND preview.source_digest = ? AND preview.kind = 'preview'
        ORDER BY max(preview.created_at, thumbnail.created_at) DESC, preview.renderer_version DESC LIMIT 1
      `).get(row.template_version_id, row.source_digest) as DerivativeRow | undefined
      if (!derivatives || derivatives.preview_media_type !== 'image/png' || derivatives.thumbnail_media_type !== 'image/png') throw new ExportRequestError('Presentation item has no complete P05 derivative pair', 409)
      const preview = this.readObject(derivatives.preview_digest, derivatives.preview_media_type, derivatives.preview_byte_size, derivatives.preview_relative_path, 'Preview derivative')
      const thumbnail = this.readObject(derivatives.thumbnail_digest, derivatives.thumbnail_media_type, derivatives.thumbnail_byte_size, derivatives.thumbnail_relative_path, 'Thumbnail derivative')
      assertPng(preview, 1280, 720)
      assertPng(thumbnail, 320, 180)
      return {
        itemId: row.item_id,
        position: row.position,
        templateVersionId: row.template_version_id,
        template: { assetId: row.asset_id, title: row.title, versionNumber: row.version_number, contractVersion: row.contract_version },
        source: { sourceSha256: row.source_digest, contentObjectSha256: row.content_object_digest, package: source },
        slotOverrides: parseOverrides(row.slot_overrides, source.manifest.slots),
        verifiedDerivatives: { rendererVersion: derivatives.renderer_version, previewSha256: derivatives.preview_digest, thumbnailSha256: derivatives.thumbnail_digest },
        thumbnail,
      }
    })
    return { presentation: { id: presentation.id, name: presentation.name, revision: presentation.revision }, items }
  }

  private readObject(digest: string, mediaType: string, byteSize: number, relativePath: string, label: string): Buffer {
    if (!SHA256.test(digest) || relativePath !== this.contentStore.relativePathFor(digest)) throw new ExportRequestError(`${label} metadata is invalid`, 409)
    let content: Buffer
    try { content = this.contentStore.read(digest) } catch { throw new ExportRequestError(`${label} integrity check failed`, 409) }
    if (content.byteLength !== byteSize || !mediaType) throw new ExportRequestError(`${label} metadata does not match CAS`, 409)
    return content
  }

  private registerContentObject(object: StoredContentObject): void {
    const existing = this.database.prepare('SELECT media_type, byte_size, relative_path FROM content_objects WHERE digest = ?').get(object.digest) as { media_type: string; byte_size: number; relative_path: string } | undefined
    if (existing) {
      if (existing.media_type !== object.mediaType || existing.byte_size !== object.byteSize || existing.relative_path !== object.relativePath) throw new ExportRequestError('Existing export object metadata conflicts with CAS', 409)
      return
    }
    this.database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(object.digest, object.mediaType, object.byteSize, object.relativePath, Date.now())
  }

  private rowSelect(): string {
    return `SELECT export.id, export.presentation_id, export.presentation_revision, export.manifest_digest, export.html_digest, export.zip_digest, export.created_at,
      manifest.media_type AS manifest_media_type, manifest.byte_size AS manifest_byte_size, manifest.relative_path AS manifest_relative_path,
      html.media_type AS html_media_type, html.byte_size AS html_byte_size, html.relative_path AS html_relative_path,
      zip.media_type AS zip_media_type, zip.byte_size AS zip_byte_size, zip.relative_path AS zip_relative_path
      FROM presentation_exports export
      JOIN content_objects manifest ON manifest.digest = export.manifest_digest
      JOIN content_objects html ON html.digest = export.html_digest
      JOIN content_objects zip ON zip.digest = export.zip_digest`
  }

  private findRow(presentationId: string, exportId: string): ExportRow | undefined {
    return this.database.prepare(`${this.rowSelect()} WHERE export.presentation_id = ? AND export.id = ?`).get(presentationId, exportId) as ExportRow | undefined
  }

  private verifyRow(row: ExportRow): { manifest: PresentationExportManifest; html: Buffer; zip: Buffer } {
    if (row.manifest_media_type !== 'application/vnd.html-presentation-export-manifest+json' || row.html_media_type !== 'text/html; charset=utf-8' || row.zip_media_type !== 'application/zip') throw new ExportRequestError('Stored export media types are invalid', 409)
    const manifestBytes = this.readObject(row.manifest_digest, row.manifest_media_type, row.manifest_byte_size, row.manifest_relative_path, 'Export manifest')
    const html = this.readObject(row.html_digest, row.html_media_type, row.html_byte_size, row.html_relative_path, 'Export HTML')
    const zip = this.readObject(row.zip_digest, row.zip_media_type, row.zip_byte_size, row.zip_relative_path, 'Export ZIP')
    let parsed: unknown
    try { parsed = JSON.parse(manifestBytes.toString('utf8')) } catch { throw new ExportRequestError('Stored export manifest is malformed', 409) }
    if (!isRecord(parsed) || `${JSON.stringify(parsed, null, 2)}\n` !== manifestBytes.toString('utf8')) throw new ExportRequestError('Stored export manifest is not canonical', 409)
    const manifest = parsed as unknown as PresentationExportManifest
    if (manifest.contractVersion !== EXPORT_CONTRACT || manifest.exportId !== row.id || manifest.owner !== 'local-owner' || manifest.presentation?.id !== row.presentation_id || manifest.presentation.revision !== row.presentation_revision || manifest.createdAt !== row.created_at || !Array.isArray(manifest.items) || !isRecord(manifest.package)) {
      throw new ExportRequestError('Stored export manifest identity is invalid', 409)
    }
    if (manifest.package.entry !== 'index.html' || manifest.package.embeddedManifest !== 'manifest.json' || manifest.package.htmlSha256 !== row.html_digest || manifest.package.zipSha256 !== row.zip_digest || manifest.package.zipByteSize !== zip.byteLength || !Array.isArray(manifest.package.files)) {
      throw new ExportRequestError('Stored export manifest output hashes are invalid', 409)
    }
    assertStoredManifestShape(manifest)
    const filePaths = new Set<string>()
    for (const file of manifest.package.files) {
      if (!file || typeof file.relativePath !== 'string' || typeof file.mediaType !== 'string' || !Number.isInteger(file.byteSize) || file.byteSize < 0 || !SHA256.test(file.sha256)) throw new ExportRequestError('Stored export file manifest is invalid', 409)
      try { assertSafeExportPath(file.relativePath) } catch { throw new ExportRequestError('Stored export file path is invalid', 409) }
      if (filePaths.has(file.relativePath)) throw new ExportRequestError('Stored export file manifest contains a duplicate path', 409)
      filePaths.add(file.relativePath)
    }
    let archive: Map<string, Buffer>
    try { archive = readStoredZip(zip) } catch { throw new ExportRequestError('Stored export ZIP structure is invalid', 409) }
    if (archive.size !== manifest.package.files.length || [...archive.keys()].some((path) => !filePaths.has(path))) throw new ExportRequestError('Stored export ZIP does not match its controlled file allowlist', 409)
    for (const file of manifest.package.files) {
      const bytes = archive.get(file.relativePath)
      if (!bytes || bytes.byteLength !== file.byteSize || sha256(bytes) !== file.sha256) throw new ExportRequestError('Stored export ZIP file hash verification failed', 409)
    }
    if (!archive.get('index.html')?.equals(html)) throw new ExportRequestError('Stored export HTML does not match the ZIP entry', 409)
    const embedded = archive.get('manifest.json')
    let embeddedValue: unknown
    try { embeddedValue = embedded ? JSON.parse(embedded.toString('utf8')) : null } catch { throw new ExportRequestError('Embedded export manifest is malformed', 409) }
    if (!isRecord(embeddedValue) || embeddedValue.contractVersion !== PACKAGE_CONTRACT || embeddedValue.exportId !== row.id || JSON.stringify(embeddedValue.presentation) !== JSON.stringify(manifest.presentation) || JSON.stringify(embeddedValue.items) !== JSON.stringify(manifest.items)) {
      throw new ExportRequestError('Embedded export manifest does not match the audit manifest', 409)
    }
    const embeddedFiles = embeddedValue.files
    if (!Array.isArray(embeddedFiles) || JSON.stringify(embeddedFiles) !== JSON.stringify(manifest.package.files.filter((file) => file.relativePath !== 'manifest.json'))) throw new ExportRequestError('Embedded export file allowlist is invalid', 409)
    assertSafeExportHtml(html.toString('utf8'), new Set(manifest.package.files.filter((file) => file.mediaType === 'image/png').map((file) => file.relativePath)))
    return { manifest, html, zip }
  }
}
