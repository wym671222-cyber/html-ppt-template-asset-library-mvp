import type BetterSqlite3 from 'better-sqlite3'
import { isInteractiveTemplatePackageManifest, type TemplatePackageSource } from '@slide-maker/shared'
import { LocalContentStore, type StoredContentObject } from '../assets/content-store.js'
import { isAllowlistedInteractiveTemplateDigest } from '../templates/interactive-template-allowlist.js'
import { assertSafeInteractiveTemplatePackage } from '../templates/interactive-template-policy.js'
import { serializeTemplatePackage } from '../templates/simulated-adapter.js'
import { LocalJobRepository } from '../jobs/local-jobs.js'
import {
  assertSafePreviewPackage,
  PreviewPolicyError,
  type SecurePreviewRender,
} from './secure-preview.js'

type Database = BetterSqlite3.Database

export const TEMPLATE_PREVIEW_JOB_TYPE = 'template-preview'

export type TemplatePreviewJobInput = Readonly<{
  templateVersionId: string
  contentObjectDigest: string
}>

export type PreviewRenderer = {
  render(source: TemplatePackageSource): Promise<SecurePreviewRender>
}

type TemplateVersionRow = {
  asset_id: string
  version_number: number
  contract_version: string
  source_digest: string
  content_object_digest: string | null
  status: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseTemplatePreviewJobInput(value: unknown): TemplatePreviewJobInput {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'contentObjectDigest,templateVersionId') {
    throw new PreviewPolicyError('Preview Job input must contain only templateVersionId and contentObjectDigest')
  }
  if (typeof value.templateVersionId !== 'string' || !value.templateVersionId) throw new PreviewPolicyError('Preview Job templateVersionId is invalid')
  if (typeof value.contentObjectDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.contentObjectDigest)) throw new PreviewPolicyError('Preview Job contentObjectDigest is invalid')
  return { templateVersionId: value.templateVersionId, contentObjectDigest: value.contentObjectDigest }
}

function parseStoredPackage(content: Buffer, expectedDigest: string): TemplatePackageSource {
  let parsed: unknown
  try {
    parsed = JSON.parse(content.toString('utf8'))
  } catch {
    throw new PreviewPolicyError('Verified CAS object is not a template package')
  }
  if (!isRecord(parsed) || !isRecord(parsed.manifest) || !isRecord(parsed.files)) throw new PreviewPolicyError('Verified CAS object has an invalid template package shape')
  const source = parsed as unknown as TemplatePackageSource
  if (isInteractiveTemplatePackageManifest(source.manifest)) {
    try { assertSafeInteractiveTemplatePackage(source) }
    catch (error) { throw new PreviewPolicyError(error instanceof Error ? error.message : 'Interactive preview package is unsafe') }
    if (!isAllowlistedInteractiveTemplateDigest(expectedDigest)) throw new PreviewPolicyError('Interactive preview package digest is not allowlisted')
  } else {
    assertSafePreviewPackage(source)
  }
  if (!serializeTemplatePackage(source).equals(content)) throw new PreviewPolicyError('Verified CAS template package is not canonical')
  return source
}

function assertPngDimensions(content: Buffer, width: number, height: number, kind: string): void {
  if (content.length < 24 || content.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || content.subarray(12, 16).toString('ascii') !== 'IHDR' || content.readUInt32BE(16) !== width || content.readUInt32BE(20) !== height) {
    throw new PreviewPolicyError(`Chromium ${kind} output is not the required ${width}x${height} PNG`)
  }
}

function assertSecureRender(render: SecurePreviewRender, source: TemplatePackageSource): void {
  if (!render.rendererVersion || /[\u0000-\u001f\u007f]/.test(render.rendererVersion)) throw new PreviewPolicyError('Chromium renderer version is invalid')
  if (render.diagnostic.allowedRequestCount < 1
    || render.diagnostic.blockedRequestCount !== 0
    || render.diagnostic.blockedSecurityEventCount !== 0
    || render.diagnostic.cookieHeaderCount !== 0
    || render.diagnostic.contextCookieCount !== 0
    || render.diagnostic.documentCookiePresent
    || render.diagnostic.forbiddenDomNodeCount !== 0
    || render.diagnostic.newWindowCount !== 0) {
    throw new PreviewPolicyError('Chromium render did not satisfy the P05 security diagnostic')
  }
  if (isInteractiveTemplatePackageManifest(source.manifest)
    && (!render.diagnostic.runtimeOpaqueOrigin
      || !render.diagnostic.templateOpaqueOrigin
      || !render.diagnostic.cookieAccessBlocked
      || !render.diagnostic.localStorageAccessBlocked
      || !render.diagnostic.sessionStorageAccessBlocked
      || !render.diagnostic.parentDomAccessBlocked
      || !render.diagnostic.topLocationAccessBlocked
      || !render.diagnostic.popupAccessBlocked
      || !render.diagnostic.topNavigationBlocked
      || !render.diagnostic.networkAccessBlocked
      || render.diagnostic.networkAuditHitCount !== 0
      || render.diagnostic.selfNavigationAuditHitCount !== 0
      || !render.diagnostic.selfNavigationBlocked
      || !render.diagnostic.runtimeContextBound
      || !render.diagnostic.commandProtocolBound
      || !render.diagnostic.forgedCommandRejected
      || !render.diagnostic.allowScriptsOnlySandbox)) {
    throw new PreviewPolicyError('Chromium render did not satisfy the P02 interactive sandbox diagnostic')
  }
  assertPngDimensions(render.previewPng, 1280, 720, 'preview')
  assertPngDimensions(render.thumbnailPng, 320, 180, 'thumbnail')
}

export class PreviewArtifactRepository {
  constructor(private readonly database: Database) {}

  loadVerifiedSource(input: TemplatePreviewJobInput, contentStore: LocalContentStore): { source: TemplatePackageSource; sourceDigest: string } {
    const version = this.database.prepare('SELECT asset_id, version_number, contract_version, source_digest, content_object_digest, status FROM template_versions WHERE id = ?').get(input.templateVersionId) as TemplateVersionRow | undefined
    if (!version || !['verified', 'available'].includes(version.status)) throw new PreviewPolicyError('Preview requires a verified TemplateVersion')
    if (!version.content_object_digest || version.content_object_digest !== input.contentObjectDigest || version.source_digest !== input.contentObjectDigest) {
      throw new PreviewPolicyError('Preview Job digest does not match the verified TemplateVersion content object')
    }

    let content: Buffer
    try {
      content = contentStore.read(input.contentObjectDigest)
    } catch (error) {
      throw new PreviewPolicyError(error instanceof Error ? error.message : 'Verified CAS content could not be read')
    }
    const source = parseStoredPackage(content, version.source_digest)
    if (source.manifest.id !== version.asset_id || source.manifest.version !== version.version_number || source.manifest.contractVersion !== version.contract_version) {
      throw new PreviewPolicyError('Stored template package identity does not match its immutable TemplateVersion')
    }
    return { source, sourceDigest: version.source_digest }
  }

  recordRender(input: {
    templateVersionId: string
    sourceDigest: string
    preview: StoredContentObject
    thumbnail: StoredContentObject
    render: SecurePreviewRender
  }): void {
    const securityDiagnostic = JSON.stringify(input.render.diagnostic)
    this.database.transaction(() => {
      this.assertRenderSourceMatchesVersion(input.templateVersionId, input.sourceDigest)
      for (const object of [input.preview, input.thumbnail]) this.registerContentObject(object)
      this.registerDerivative(input.templateVersionId, 'preview', input.sourceDigest, input.preview.digest, input.render.rendererVersion, securityDiagnostic)
      this.registerDerivative(input.templateVersionId, 'thumbnail', input.sourceDigest, input.thumbnail.digest, input.render.rendererVersion, securityDiagnostic)
      this.promoteAfterCompleteRender(input.templateVersionId, input.sourceDigest, input.render.rendererVersion)
    })()
  }

  private assertRenderSourceMatchesVersion(templateVersionId: string, sourceDigest: string): void {
    const version = this.database.prepare('SELECT source_digest, content_object_digest, status FROM template_versions WHERE id = ?').get(templateVersionId) as Pick<TemplateVersionRow, 'source_digest' | 'content_object_digest' | 'status'> | undefined
    if (!version || !['verified', 'available'].includes(version.status)) throw new PreviewPolicyError('Preview render target requires a verified TemplateVersion')
    if (!version.content_object_digest || version.source_digest !== sourceDigest || version.content_object_digest !== sourceDigest) {
      throw new PreviewPolicyError('Preview render source digest does not match the TemplateVersion content object')
    }
  }

  private promoteAfterCompleteRender(templateVersionId: string, sourceDigest: string, rendererVersion: string): void {
    this.database.prepare(`
      UPDATE template_assets
      SET current_version_id = ?, updated_at = ?
      WHERE id = (
        SELECT asset_id FROM template_versions
        WHERE id = ?
          AND status IN ('verified', 'available')
          AND source_digest = ?
          AND content_object_digest = ?
      )
        AND current_version_id IS NOT ?
        AND EXISTS (
          SELECT 1
          FROM template_preview_derivatives preview
          JOIN template_preview_derivatives thumbnail
            ON thumbnail.template_version_id = preview.template_version_id
            AND thumbnail.source_digest = preview.source_digest
            AND thumbnail.renderer_version = preview.renderer_version
            AND thumbnail.kind = 'thumbnail'
          WHERE preview.template_version_id = ?
            AND preview.source_digest = ?
            AND preview.renderer_version = ?
            AND preview.kind = 'preview'
        )
        AND EXISTS (
          SELECT 1 FROM template_versions candidate
          WHERE candidate.id = ?
            AND candidate.status IN ('verified', 'available')
            AND candidate.source_digest = ?
            AND candidate.content_object_digest = ?
        )
        AND (
          current_version_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM template_versions current, template_versions candidate
            WHERE current.id = template_assets.current_version_id
              AND candidate.id = ?
              AND candidate.version_number > current.version_number
          )
        )
    `).run(
      templateVersionId,
      Date.now(),
      templateVersionId,
      sourceDigest,
      sourceDigest,
      templateVersionId,
      templateVersionId,
      sourceDigest,
      rendererVersion,
      templateVersionId,
      sourceDigest,
      sourceDigest,
      templateVersionId,
    )
  }

  private registerContentObject(object: StoredContentObject): void {
    const existing = this.database.prepare('SELECT media_type, byte_size, relative_path FROM content_objects WHERE digest = ?').get(object.digest) as { media_type: string; byte_size: number; relative_path: string } | undefined
    if (existing) {
      if (existing.media_type !== object.mediaType || existing.byte_size !== object.byteSize || existing.relative_path !== object.relativePath) throw new PreviewPolicyError('Existing preview content object metadata conflicts with CAS')
      return
    }
    this.database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(object.digest, object.mediaType, object.byteSize, object.relativePath, Date.now())
  }

  private registerDerivative(templateVersionId: string, kind: 'preview' | 'thumbnail', sourceDigest: string, contentDigest: string, rendererVersion: string, securityDiagnostic: string): void {
    const existing = this.database.prepare('SELECT content_digest, security_diagnostic FROM template_preview_derivatives WHERE template_version_id = ? AND kind = ? AND source_digest = ? AND renderer_version = ?').get(templateVersionId, kind, sourceDigest, rendererVersion) as { content_digest: string; security_diagnostic: string } | undefined
    if (existing) {
      if (existing.content_digest !== contentDigest || existing.security_diagnostic !== securityDiagnostic) throw new PreviewPolicyError('Stable preview identity produced conflicting immutable output')
      return
    }
    this.database.prepare('INSERT INTO template_preview_derivatives (template_version_id, kind, source_digest, content_digest, renderer_version, security_diagnostic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(templateVersionId, kind, sourceDigest, contentDigest, rendererVersion, securityDiagnostic, Date.now())
  }
}

function diagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown preview failure'
  return `P05 preview rejected: ${message}`.slice(0, 500)
}

export class TemplatePreviewJobWorker {
  private readonly artifacts: PreviewArtifactRepository

  constructor(
    database: Database,
    private readonly jobs: LocalJobRepository,
    private readonly contentStore: LocalContentStore,
    private readonly renderer: PreviewRenderer,
    private readonly workerId: string,
    private readonly leaseMs: number,
  ) {
    this.artifacts = new PreviewArtifactRepository(database)
  }

  async runOnce(): Promise<boolean> {
    const job = this.jobs.claim(this.workerId, this.leaseMs, [TEMPLATE_PREVIEW_JOB_TYPE])
    if (!job) return false
    try {
      const input = parseTemplatePreviewJobInput(job.inputSnapshot)
      const { source, sourceDigest } = this.artifacts.loadVerifiedSource(input, this.contentStore)
      const render = await this.renderer.render(source)
      assertSecureRender(render, source)
      const preview = this.contentStore.put(render.previewPng, 'image/png')
      const thumbnail = this.contentStore.put(render.thumbnailPng, 'image/png')
      this.artifacts.recordRender({ templateVersionId: input.templateVersionId, sourceDigest, preview, thumbnail, render })
      this.jobs.succeed(job.id, this.workerId, preview.digest)
    } catch (error) {
      this.jobs.fail(job.id, this.workerId, diagnostic(error), !(error instanceof PreviewPolicyError))
    }
    return true
  }
}
