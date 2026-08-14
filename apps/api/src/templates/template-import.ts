import { createHash } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import JSZip, { type JSZipObject } from 'jszip'
import type { TemplatePackageManifest, TemplatePackageSource } from '@slide-maker/shared'
import { AssetCatalogRepository } from '../assets/catalog-repository.js'
import { LocalJobRepository, type LocalJob } from '../jobs/local-jobs.js'
import { TEMPLATE_PREVIEW_JOB_TYPE, parseTemplatePreviewJobInput } from '../previews/preview-jobs.js'
import { assertSafePreviewPackage } from '../previews/secure-preview.js'
import { adaptTemplatePackageSource, type SimulatedTemplateAdapterResult } from './simulated-adapter.js'

type Database = BetterSqlite3.Database

export const MAX_TEMPLATE_ZIP_BYTES = 5 * 1024 * 1024
export const MAX_TEMPLATE_HTML_BYTES = 5 * 1024 * 1024
export const MAX_TEMPLATE_HTML_JSON_BYTES = 7 * 1024 * 1024
export const MAX_TEMPLATE_EXPANDED_BYTES = 10 * 1024 * 1024
export const MAX_TEMPLATE_FILES = 32
const MAX_TEMPLATE_FILE_BYTES = 2 * 1024 * 1024
const MAX_MANIFEST_BYTES = 64 * 1024
const SAFE_PACKAGE_FILE = /^(?:[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)+$/
const SAFE_JOB_ID = /^template-preview-[0-9a-f]{32}$/
const SAFE_HTML_FILENAME = /^[^/\\\u0000-\u001f\u007f]{1,255}\.html?$/i
const SAFE_CATEGORY_LABEL = /^[\p{L}\p{N}][\p{L}\p{N}/_-]{0,79}$/u
const SAFE_TAG_LABEL = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u
const STYLE_BLOCK = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi

export class TemplateImportError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 500 = 409) {
    super(message.replace(/[\r\n\t]+/g, ' ').replace(/(?:\/[^\s"'():]+){2,}/g, '[path]').slice(0, 300))
  }
}

export type TemplateImportJobSummary = Readonly<{
  id: string
  status: LocalJob['status']
  attempt: number
  maxAttempts: number
  diagnostic: string
  available: boolean
}>

export type TemplateImportSummary = Readonly<{
  assetId: string
  versionId: string
  created: boolean
  job: TemplateImportJobSummary
}>

export type HtmlTemplateImportRequest = Readonly<{
  filename: string
  mimeType: string
  contentBase64: string
  title: string
  summary: string
  category: string
  tags: string[]
}>

export type HtmlTemplateValidationSummary = Readonly<{
  assetId: string
  versionId: string
  title: string
  category: string
  tags: string[]
  sourceBytes: number
  normalizedFiles: string[]
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new TemplateImportError(`${label} must be text`, 400)
  const normalized = value.trim().normalize('NFC')
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) throw new TemplateImportError(`${label} is invalid`, 400)
  return normalized
}

function strictBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(MAX_TEMPLATE_HTML_BYTES / 3) * 4 + 4 || !/^[a-z0-9+/]+={0,2}$/i.test(value)) {
    throw new TemplateImportError('HTML contentBase64 is invalid', 400)
  }
  const content = Buffer.from(value, 'base64')
  if (content.byteLength === 0 || content.byteLength > MAX_TEMPLATE_HTML_BYTES || content.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new TemplateImportError('HTML contentBase64 is invalid or exceeds 5 MiB', 400)
  }
  return content
}

function normalizeInlineStyles(html: string): { html: string; css: string | null } {
  const styles: string[] = []
  let normalized = html.replace(STYLE_BLOCK, (_block, attributes: string, css: string) => {
    if (attributes.trim()) throw new TemplateImportError('HTML style blocks cannot contain attributes', 400)
    styles.push(css.trim())
    return ''
  })
  if (/<\/?style\b/i.test(normalized)) throw new TemplateImportError('HTML contains a malformed style block', 400)
  const combinedCss = styles.filter(Boolean).join('\n\n')
  if (!combinedCss) return { html: normalized, css: null }
  const link = '<link rel="stylesheet" href="styles.css">'
  if (/<head\b[^>]*>/i.test(normalized)) normalized = normalized.replace(/<head\b[^>]*>/i, (head) => `${head}${link}`)
  else if (/<html\b[^>]*>/i.test(normalized)) normalized = normalized.replace(/<html\b[^>]*>/i, (root) => `${root}<head>${link}</head>`)
  else normalized = `<head>${link}</head>${normalized}`
  if (/<html\b[^>]*>/i.test(normalized)) {
    normalized = normalized.replace(/<html\b([^>]*)>/i, (_root, attributes: string) => {
      if (/\bdata-ppt-template-root\b/i.test(attributes)) throw new TemplateImportError('HTML root contains a reserved template attribute', 400)
      return `<html${attributes} data-ppt-template-root="">`
    })
  } else {
    const content = normalized.replace(/<!doctype\s+html\s*>/i, '')
    normalized = `<!doctype html><html data-ppt-template-root="">${content}</html>`
  }
  return { html: normalized, css: `@scope (html[data-ppt-template-root]) {\n${combinedCss}\n}` }
}

function parseHtmlImportRequest(value: unknown): { template: SimulatedTemplateAdapterResult; validation: HtmlTemplateValidationSummary } {
  if (!isRecord(value)) throw new TemplateImportError('HTML import body must be one JSON object', 400)
  exactKeys(value, ['filename', 'mimeType', 'contentBase64', 'title', 'summary', 'category', 'tags'], 'HTML import body')
  if (typeof value.filename !== 'string' || !SAFE_HTML_FILENAME.test(value.filename)) throw new TemplateImportError('HTML filename must end in .html or .htm', 400)
  if (value.mimeType !== 'text/html') throw new TemplateImportError('HTML MIME type must be text/html', 400)
  const title = normalizedText(value.title, 'HTML title', 120)
  const summary = normalizedText(value.summary, 'HTML summary', 500)
  const category = normalizedText(value.category, 'HTML category', 80)
  if (!SAFE_CATEGORY_LABEL.test(category)) throw new TemplateImportError('HTML category contains unsupported characters', 400)
  if (!Array.isArray(value.tags) || value.tags.length > 20) throw new TemplateImportError('HTML tags must be an array with at most 20 values', 400)
  const tags = value.tags.map((tag) => normalizedText(tag, 'HTML tag', 40))
  if (new Set(tags).size !== tags.length || tags.some((tag) => !SAFE_TAG_LABEL.test(tag))) throw new TemplateImportError('HTML tags must be unique safe labels', 400)
  tags.sort()
  const content = strictBase64(value.contentBase64)
  let html: string
  try { html = new TextDecoder('utf-8', { fatal: true }).decode(content) }
  catch { throw new TemplateImportError('HTML file must be valid UTF-8', 400) }
  if (html.includes('\u0000') || !/<(?:!doctype\s+html|html|head|body)\b/i.test(html)) throw new TemplateImportError('HTML file does not contain a recognizable document', 400)
  const normalized = normalizeInlineStyles(html)
  const identity = createHash('sha256').update(JSON.stringify({ html: normalized.html, css: normalized.css, title, summary, category, tags })).digest('hex')
  const id = `html-${identity.slice(0, 20)}`
  const files: Record<string, string> = { 'index.html': normalized.html }
  if (normalized.css !== null) files['styles.css'] = normalized.css
  const source: TemplatePackageSource = {
    manifest: {
      contractVersion: 'html-template/v1',
      id,
      version: 1,
      title,
      summary,
      category,
      tags,
      entry: 'index.html',
      files: Object.keys(files),
      slots: [],
    },
    files,
  }
  try { assertSafePreviewPackage(source) }
  catch (error) { throw new TemplateImportError(error instanceof Error ? error.message : 'HTML violates preview policy', 400) }
  const template = adaptTemplatePackageSource(source)
  return {
    template,
    validation: { assetId: id, versionId: `${id}-v1`, title, category, tags, sourceBytes: content.byteLength, normalizedFiles: Object.keys(files) },
  }
}

export function validateUploadedTemplateHtml(value: unknown): HtmlTemplateValidationSummary {
  return parseHtmlImportRequest(value).validation
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const keys = Object.keys(value).sort().join(',')
  if (keys !== [...expected].sort().join(',')) throw new TemplateImportError(`${label} contains missing or unknown fields`, 400)
}

function assertManifestShape(value: unknown): asserts value is TemplatePackageManifest {
  if (!isRecord(value)) throw new TemplateImportError('Template manifest must be one JSON object', 400)
  exactKeys(value, ['contractVersion', 'id', 'version', 'title', 'summary', 'category', 'tags', 'entry', 'files', 'slots'], 'Template manifest')
  if (!Array.isArray(value.files) || value.files.some((file) => typeof file !== 'string')) throw new TemplateImportError('Template manifest files must be a string array', 400)
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string')) throw new TemplateImportError('Template manifest tags must be a string array', 400)
  if (!Array.isArray(value.slots)) throw new TemplateImportError('Template manifest slots must be an array', 400)
  for (const [index, slot] of value.slots.entries()) {
    if (!isRecord(slot)) throw new TemplateImportError(`Template slot ${index} must be an object`, 400)
    const required = ['id', 'type', 'required']
    const optional = ['maxLength', 'default'].filter((key) => Object.hasOwn(slot, key))
    exactKeys(slot, [...required, ...optional], `Template slot ${index}`)
  }
}

function entrySize(entry: JSZipObject): number {
  const metadata = entry as unknown as { _data?: { uncompressedSize?: number } }
  const value = metadata._data?.uncompressedSize
  if (!Number.isInteger(value) || Number(value) < 0) throw new TemplateImportError('Template ZIP entry size metadata is invalid', 400)
  return Number(value)
}

function assertSafeZipEntry(entry: JSZipObject): void {
  const original = (entry as JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name
  if (original !== entry.name || original.startsWith('/') || original.includes('\\') || original.includes(':') || original.split('/').includes('..')) throw new TemplateImportError('Template ZIP contains an unsafe path', 400)
  const normalized = entry.dir ? entry.name.replace(/\/$/, '') : entry.name
  if (!normalized || !SAFE_PACKAGE_FILE.test(normalized) || normalized.includes('..')) throw new TemplateImportError('Template ZIP contains an unsafe path', 400)
  if (typeof entry.unixPermissions === 'number' && ((entry.unixPermissions >> 12) & 0xf) === 0xa) throw new TemplateImportError('Template ZIP cannot contain symbolic links', 400)
}

async function readUtf8(entry: JSZipObject, maxBytes: number): Promise<string> {
  const size = entrySize(entry)
  if (size > maxBytes) throw new TemplateImportError(`Template ZIP entry exceeds ${maxBytes} bytes`, 400)
  const content = await entry.async('uint8array')
  if (content.byteLength !== size) throw new TemplateImportError('Template ZIP entry size changed during extraction', 400)
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(content)
    if (text.includes('\u0000')) throw new TemplateImportError('Template ZIP text contains NUL bytes', 400)
    return text
  } catch (error) {
    if (error instanceof TemplateImportError) throw error
    throw new TemplateImportError('Template ZIP contains invalid UTF-8 text', 400)
  }
}

export async function parseUploadedTemplateZip(content: Uint8Array): Promise<SimulatedTemplateAdapterResult> {
  const bytes = Buffer.from(content)
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_TEMPLATE_ZIP_BYTES) throw new TemplateImportError('Template ZIP size is invalid', 400)
  let zip: JSZip
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false }) }
  catch { throw new TemplateImportError('Template ZIP structure or CRC is invalid', 400) }
  const entries = Object.values(zip.files)
  if (entries.length < 2 || entries.length > MAX_TEMPLATE_FILES + 17) throw new TemplateImportError('Template ZIP entry count is invalid', 400)
  for (const entry of entries) assertSafeZipEntry(entry)
  const files = entries.filter((entry) => !entry.dir)
  if (files.length < 2 || files.length > MAX_TEMPLATE_FILES + 1) throw new TemplateImportError(`Template ZIP must contain manifest.json and at most ${MAX_TEMPLATE_FILES} declared files`, 400)
  const totalExpanded = files.reduce((total, entry) => total + entrySize(entry), 0)
  if (totalExpanded > MAX_TEMPLATE_EXPANDED_BYTES) throw new TemplateImportError('Template ZIP expanded content exceeds 10 MiB', 400)
  const manifestEntry = zip.file('manifest.json')
  if (!manifestEntry || manifestEntry.dir) throw new TemplateImportError('Template ZIP requires root manifest.json', 400)
  const manifestText = await readUtf8(manifestEntry, MAX_MANIFEST_BYTES)
  let manifestValue: unknown
  try { manifestValue = JSON.parse(manifestText) } catch { throw new TemplateImportError('Template manifest is malformed JSON', 400) }
  assertManifestShape(manifestValue)
  const manifest = manifestValue
  const declaredDirectories = new Set(manifest.files.flatMap((name) => name.split('/').slice(0, -1).map((_, index, pieces) => `${pieces.slice(0, index + 1).join('/')}/`)))
  if (entries.some((entry) => entry.dir && !declaredDirectories.has(entry.name))) throw new TemplateImportError('Template ZIP contains an undeclared directory', 400)
  if (manifest.files.length > MAX_TEMPLATE_FILES) throw new TemplateImportError(`Template manifest is limited to ${MAX_TEMPLATE_FILES} files`, 400)
  const actualNames = files.map((entry) => entry.name).filter((name) => name !== 'manifest.json').sort()
  if (JSON.stringify(actualNames) !== JSON.stringify([...manifest.files].sort())) throw new TemplateImportError('Template ZIP files must exactly match manifest.files', 400)
  if (actualNames.some((name) => !/\.(?:html|css)$/.test(name))) throw new TemplateImportError('Template ZIP accepts only HTML and CSS files', 400)
  const sourceFiles: Record<string, string> = {}
  for (const name of manifest.files) sourceFiles[name] = await readUtf8(zip.file(name)!, MAX_TEMPLATE_FILE_BYTES)
  const source: TemplatePackageSource = { manifest, files: sourceFiles }
  try { assertSafePreviewPackage(source) }
  catch (error) { throw new TemplateImportError(error instanceof Error ? error.message : 'Template package violates preview policy', 400) }
  return adaptTemplatePackageSource(source)
}

function previewJobId(template: SimulatedTemplateAdapterResult): string {
  return `template-preview-${createHash('sha256').update(`${template.version.id}\u0000${template.version.sourceDigest}`).digest('hex').slice(0, 32)}`
}

export class TemplateImportService {
  constructor(
    private readonly database: Database,
    private readonly catalog: AssetCatalogRepository,
    private readonly jobs: LocalJobRepository,
  ) {}

  async importZip(content: Uint8Array): Promise<TemplateImportSummary> {
    const template = await parseUploadedTemplateZip(content)
    return this.registerAndQueue(template)
  }

  async importHtml(value: unknown): Promise<TemplateImportSummary> {
    return this.registerAndQueue(parseHtmlImportRequest(value).template)
  }

  validateHtml(value: unknown): HtmlTemplateValidationSummary {
    return validateUploadedTemplateHtml(value)
  }

  private registerAndQueue(template: SimulatedTemplateAdapterResult): TemplateImportSummary {
    try {
      return this.database.transaction(() => {
        let registered
        try { registered = this.catalog.registerTemplate(template) }
        catch (error) { throw new TemplateImportError(error instanceof Error ? error.message : 'Template catalog registration failed', 409) }
        const id = previewJobId(template)
        const snapshot = { templateVersionId: registered.versionId, contentObjectDigest: registered.contentObject.digest }
        const existing = this.jobs.get(id)
        if (existing) {
          let parsed
          try { parsed = parseTemplatePreviewJobInput(existing.inputSnapshot) } catch { throw new TemplateImportError('Existing preview Job snapshot conflicts with this template', 409) }
          if (existing.type !== TEMPLATE_PREVIEW_JOB_TYPE || parsed.templateVersionId !== snapshot.templateVersionId || parsed.contentObjectDigest !== snapshot.contentObjectDigest) throw new TemplateImportError('Existing preview Job identity conflicts with this template', 409)
        } else {
          this.jobs.enqueue({ id, type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: snapshot, inputRevision: template.version.versionNumber, maxAttempts: 2 })
        }
        return { assetId: registered.assetId, versionId: registered.versionId, created: registered.created, job: this.job(id) }
      })()
    } catch (error) {
      if (error instanceof TemplateImportError) throw error
      throw new TemplateImportError(error instanceof Error ? error.message : 'Template registration and preview queue failed', 500)
    }
  }

  job(id: string): TemplateImportJobSummary {
    if (!SAFE_JOB_ID.test(id)) throw new TemplateImportError('Template import Job id is invalid', 400)
    const job = this.jobs.get(id)
    if (!job || job.type !== TEMPLATE_PREVIEW_JOB_TYPE) throw new TemplateImportError('Template import Job not found', 404)
    let input
    try { input = parseTemplatePreviewJobInput(job.inputSnapshot) } catch { throw new TemplateImportError('Template import Job snapshot is invalid', 409) }
    const available = Boolean(this.database.prepare(`
      SELECT 1
      FROM template_preview_derivatives preview
      JOIN template_preview_derivatives thumbnail
        ON thumbnail.template_version_id = preview.template_version_id
        AND thumbnail.source_digest = preview.source_digest
        AND thumbnail.renderer_version = preview.renderer_version
        AND thumbnail.kind = 'thumbnail'
      WHERE preview.template_version_id = ? AND preview.source_digest = ? AND preview.kind = 'preview'
      LIMIT 1
    `).get(input.templateVersionId, input.contentObjectDigest))
    return { id: job.id, status: job.status, attempt: job.attempt, maxAttempts: job.maxAttempts, diagnostic: job.diagnostic.slice(0, 300), available }
  }
}
