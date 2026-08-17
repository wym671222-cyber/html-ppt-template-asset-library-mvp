import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildTemplateRuntimeCsp,
  isTemplateRuntimeCommand,
  isTemplateRuntimeEventMessage,
  TEMPLATE_RUNTIME_MODE_HEADER,
  TEMPLATE_RUNTIME_PROTOCOL,
  TEMPLATE_RUNTIME_PROTOCOL_HEADER,
  TEMPLATE_RUNTIME_SESSION_HEADER,
  TEMPLATE_RUNTIME_STATIC_RESPONSE_HEADERS,
  TEMPLATE_STATIC_RUNTIME_CSP,
  templateRuntimeNonceFromCsp,
  type TemplatePackageSource,
} from '../packages/shared/src/index.js'
import { createApp } from '../apps/api/src/app.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { AssetLibraryCatalog } from '../apps/api/src/assets/library-catalog.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { LocalJobRepository } from '../apps/api/src/jobs/local-jobs.js'
import { PreviewArtifactRepository, TEMPLATE_PREVIEW_JOB_TYPE, TemplatePreviewJobWorker } from '../apps/api/src/previews/preview-jobs.js'
import { SecurePreviewRenderer, type SecurePreviewRender } from '../apps/api/src/previews/secure-preview.js'
import { compileInteractiveTemplateRuntime } from '../apps/api/src/templates/interactive-template-runtime.js'
import { adaptSimulatedTemplatePackage, adaptTemplatePackageSource } from '../apps/api/src/templates/simulated-adapter.js'
import { createTrustedTestAuth, seedTestUser } from './p14-test-support.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): { all(...parameters: unknown[]): unknown[]; get(...parameters: unknown[]): unknown; run(...parameters: unknown[]): { changes: number } }
  close(): void
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite
const fixtureRoot = join(process.cwd(), 'fixtures/p03-simulated-template')
const allowlistedV2Digest = 'fb0e964ed926db0c20bb1706044db6e1c52b5ee65dea7d20ae0a3699611e1490'
const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const chromiumExecutablePath = process.env.P02_CHROMIUM_PATH ?? (existsSync(macChrome) ? macChrome : undefined)

function interactiveSource(): TemplatePackageSource {
  return {
    manifest: {
      contractVersion: 'html-template/v2',
      id: 'simulated-quarterly-brief',
      version: 2,
      title: 'Simulated Quarterly Brief',
      summary: 'A repository-local fixture for validating the v1 HTML template package contract.',
      category: 'report/quarterly',
      tags: ['simulated', 'quarterly', 'brief'],
      entry: 'index.html',
      files: ['styles.css', 'runtime.js', 'index.html'],
      slots: [
        { id: 'title', type: 'text', required: true, maxLength: 120 },
        { id: 'subtitle', type: 'text', required: false, default: 'Repository-local simulation', maxLength: 200 },
        { id: 'accent-color', type: 'color', required: false, default: '#2563eb' },
      ],
      runtime: { viewport: { height: 1080, width: 1920 }, mode: 'sandboxed-js' },
    },
    files: {
      'index.html': `<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main data-template-slot="accent-color"><h1 data-template-slot="title">Interactive fixture</h1><p data-template-slot="subtitle">Repository-local simulation</p><img alt="" src="data:image/png;base64,${onePixelPng}"><button id="advance" type="button">Advance</button></main><script src="runtime.js"></script></body></html>`,
      'runtime.js': `document.querySelector('#advance')?.addEventListener('click', () => document.body.toggleAttribute('data-advanced'))`,
      'styles.css': 'body{margin:0} button{cursor:pointer}',
    },
  }
}

function fakePng(width: number, height: number, marker: number): Buffer {
  const content = Buffer.alloc(25)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(content)
  content.writeUInt32BE(13, 8)
  content.write('IHDR', 12, 'ascii')
  content.writeUInt32BE(width, 16)
  content.writeUInt32BE(height, 20)
  content[24] = marker
  return content
}

function fakeRender(): SecurePreviewRender {
  return {
    previewPng: fakePng(1280, 720, 1),
    thumbnailPng: fakePng(320, 180, 2),
    rendererVersion: 'p02-api-fixture-renderer',
    diagnostic: {
      allowedRequestCount: 2,
      blockedRequestCount: 0,
      blockedSecurityEventCount: 0,
      cookieHeaderCount: 0,
      contextCookieCount: 0,
      documentCookiePresent: false,
      forbiddenDomNodeCount: 0,
      newWindowCount: 0,
      runtimeOpaqueOrigin: true,
      templateOpaqueOrigin: true,
      cookieAccessBlocked: true,
      localStorageAccessBlocked: true,
      sessionStorageAccessBlocked: true,
      parentDomAccessBlocked: true,
      topLocationAccessBlocked: true,
      popupAccessBlocked: true,
      topNavigationBlocked: true,
      networkAccessBlocked: true,
      networkAuditHitCount: 0,
      selfNavigationAuditHitCount: 0,
      selfNavigationBlocked: true,
      runtimeContextBound: true,
      commandProtocolBound: true,
      forgedCommandRejected: true,
      allowScriptsOnlySandbox: true,
    },
  }
}

function state() {
  const root = mkdtempSync(join(tmpdir(), 'interactive-template-p02-'))
  const databasePath = join(root, 'asset-library.db')
  migrateDatabase(databasePath)
  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  const user = seedTestUser(database as never)
  const store = new LocalContentStore(join(root, 'objects'))
  const repository = new AssetCatalogRepository(database as never, store)
  const v1 = repository.registerTemplate(adaptSimulatedTemplatePackage(fixtureRoot))
  const v2Template = adaptTemplatePackageSource(interactiveSource())
  expect(v2Template.version.sourceDigest).toBe(allowlistedV2Digest)
  const v2 = repository.registerTemplate(v2Template, { promote: false })
  const catalog = new AssetLibraryCatalog(database as never, store)
  const app = createApp({ catalog, auth: createTrustedTestAuth(user) })
  return { root, database, store, repository, v1, v2, v2Template, catalog, app }
}

describe('P02 self-contained interactive runtime compiler and message protocol', () => {
  it('compiles only the reviewed digest into a nonce-bound offline page with exact schemas', () => {
    const compiled = compileInteractiveTemplateRuntime(interactiveSource())
    expect(compiled).toMatchObject({ sourceDigest: allowlistedV2Digest, assetId: 'simulated-quarterly-brief', version: 2 })
    expect(compiled.sessionId).toMatch(/^[0-9a-f]{32}$/)
    const nonce = templateRuntimeNonceFromCsp(compiled.contentSecurityPolicy)
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(compiled.contentSecurityPolicy).toBe(buildTemplateRuntimeCsp(nonce!))
    expect(compiled.contentSecurityPolicy).toContain("default-src 'none'")
    expect(compiled.contentSecurityPolicy).toContain("connect-src 'none'")
    expect(compiled.contentSecurityPolicy).toContain("media-src 'none'")
    expect(compiled.contentSecurityPolicy).toContain("font-src 'none'")
    expect(compiled.contentSecurityPolicy).toContain('frame-src data:')
    expect(compiled.contentSecurityPolicy).toContain('child-src data:')
    expect(compiled.contentSecurityPolicy).not.toMatch(/frame-src[^;]*(?:https?:|\*|'self')/)
    expect(compiled.contentSecurityPolicy).toContain("object-src 'none'")
    expect(compiled.contentSecurityPolicy).toContain("base-uri 'none'")
    expect(compiled.contentSecurityPolicy).toContain("form-action 'none'")
    expect(compiled.contentSecurityPolicy).toContain("navigate-to 'none'")
    expect(compiled.contentSecurityPolicy).toContain('sandbox allow-scripts')
    expect(compiled.contentSecurityPolicy).not.toContain('allow-same-origin')

    const html = compiled.html.toString('utf8')
    expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=|<link\b/i)
    expect(html).not.toMatch(/https?:|wss?:|file:/i)
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).not.toContain('allow-same-origin')
    const encodedDocument = /data:text\/html;base64,([A-Za-z0-9+/=]+)/.exec(html)?.[1]
    expect(encodedDocument).toBeTruthy()
    const templateDocument = Buffer.from(encodedDocument!, 'base64').toString('utf8')
    expect(templateDocument).toContain('data:image/png;base64,')
    expect(templateDocument).toContain('html-template:replay')
    expect(templateDocument).toContain('html-template:reset')

    const ready = { protocol: TEMPLATE_RUNTIME_PROTOCOL, type: 'ready', sessionId: compiled.sessionId, assetId: compiled.assetId, version: compiled.version, sourceDigest: compiled.sourceDigest }
    const error = { protocol: TEMPLATE_RUNTIME_PROTOCOL, type: 'error', sessionId: compiled.sessionId, assetId: compiled.assetId, version: compiled.version, code: 'runtime-error' }
    const navigationBlocked = { ...error, code: 'navigation-blocked' }
    const reset = { protocol: TEMPLATE_RUNTIME_PROTOCOL, type: 'reset', sessionId: compiled.sessionId, sequence: 1 }
    expect(isTemplateRuntimeEventMessage(ready)).toBe(true)
    expect(isTemplateRuntimeEventMessage(error)).toBe(true)
    expect(isTemplateRuntimeEventMessage(navigationBlocked)).toBe(true)
    expect(isTemplateRuntimeEventMessage({ ...navigationBlocked, code: 'navigation-observed' })).toBe(false)
    expect(isTemplateRuntimeEventMessage({ ...navigationBlocked, extra: true })).toBe(false)
    expect(isTemplateRuntimeCommand(reset)).toBe(true)
    expect(isTemplateRuntimeCommand({ ...reset, sequence: 0 })).toBe(false)
    expect(isTemplateRuntimeCommand({ ...reset, extra: true })).toBe(false)
    expect(isTemplateRuntimeEventMessage({ ...ready, sessionId: '0'.repeat(32), extra: true })).toBe(false)

    const changed = structuredClone(interactiveSource())
    ;(changed.files as Record<string, string>)['runtime.js'] += ';document.body.dataset.unreviewed="true"'
    expect(() => compileInteractiveTemplateRuntime(changed)).toThrow(/not allowlisted/)
  })

  it('keeps the repository Web boundary on one exact runtime proxy without granting same-origin sandbox power', () => {
    const boundarySources = [
      'apps/web/src/routes/api/catalog/assets/[assetId]/runtime/+server.ts',
      'apps/web/src/lib/server/bff.ts',
      'apps/web/src/lib/server/bff-boundary.ts',
    ].map((path) => readFileSync(join(process.cwd(), path), 'utf8')).join('\n')
    const runtimeSources = [
      'apps/web/src/routes/api/catalog/assets/[assetId]/runtime/+server.ts',
      'apps/web/src/hooks.server.ts',
      'apps/api/src/previews/interactive-secure-preview.ts',
    ].map((path) => readFileSync(join(process.cwd(), path), 'utf8')).join('\n')
    expect(boundarySources).toContain('forwardTemplateRuntime')
    expect(boundarySources).toContain('validatedTemplateRuntimeHeaders')
    expect(runtimeSources).toContain('sandbox="allow-scripts"')
    expect(runtimeSources).not.toContain('allow-same-origin')
    expect(runtimeSources).not.toMatch(/\.srcdoc\b|srcdoc\s*=|createObjectURL|blob:|file:\/\//i)
  })
})

describe('P02 active/current/allowlisted runtime API boundary', () => {
  it('refuses promotion when the unrestricted self-navigation listener records any hit', async () => {
    const current = state()
    try {
      const jobs = new LocalJobRepository(current.database as never)
      jobs.enqueue({
        id: 'p02-self-navigation-leak',
        type: TEMPLATE_PREVIEW_JOB_TYPE,
        inputSnapshot: { templateVersionId: current.v2.versionId, contentObjectDigest: current.v2.contentObject.digest },
        inputRevision: 2,
        maxAttempts: 1,
      })
      const safe = fakeRender()
      const renderer = {
        render: async () => ({
          ...safe,
          diagnostic: { ...safe.diagnostic, selfNavigationAuditHitCount: 1 },
        }),
      }
      const worker = new TemplatePreviewJobWorker(current.database as never, jobs, current.store, renderer, 'p02-leak-negative', 30_000)
      await expect(worker.runOnce()).resolves.toBe(true)
      expect(jobs.get('p02-self-navigation-leak')).toMatchObject({ status: 'failed', attempt: 1 })
      expect(current.database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(current.v2.assetId)).toEqual({ current_version_id: current.v1.versionId })
      expect(current.database.prepare('SELECT count(*) AS count FROM template_preview_derivatives WHERE template_version_id = ?').get(current.v2.versionId)).toEqual({ count: 0 })
    } finally {
      current.database.close()
      rmSync(current.root, { recursive: true, force: true })
    }
  })

  it('serves current v1 as static, refuses non-current v2, then serves promoted v2 with exact headers', async () => {
    const current = state()
    try {
      const path = `http://127.0.0.1:3001/api/catalog/assets/${current.v2.assetId}/runtime`
      const staticResponse = await current.app.request(path)
      expect(staticResponse.status).toBe(200)
      expect(staticResponse.headers.get(TEMPLATE_RUNTIME_MODE_HEADER)).toBe('sandboxed-static')
      expect(staticResponse.headers.get(TEMPLATE_RUNTIME_PROTOCOL_HEADER)).toBeNull()
      expect(staticResponse.headers.get(TEMPLATE_RUNTIME_SESSION_HEADER)).toBeNull()
      expect(staticResponse.headers.get('content-security-policy')).toBe(TEMPLATE_STATIC_RUNTIME_CSP)
      const staticHtml = await staticResponse.text()
      expect(staticHtml).toContain('Quarterly brief title')
      expect(staticHtml).toContain('<style data-template-stylesheet="styles.css">')
      expect(staticHtml).not.toMatch(/<script\b|<link\b|https?:|file:/i)
      expect(current.database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(current.v2.assetId)).toEqual({ current_version_id: current.v1.versionId })

      const render = fakeRender()
      const preview = current.store.put(render.previewPng, 'image/png')
      const thumbnail = current.store.put(render.thumbnailPng, 'image/png')
      new PreviewArtifactRepository(current.database as never).recordRender({ templateVersionId: current.v2.versionId, sourceDigest: allowlistedV2Digest, preview, thumbnail, render })
      expect(current.database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(current.v2.assetId)).toEqual({ current_version_id: current.v2.versionId })

      const detail = await current.app.request('http://127.0.0.1:3001/api/catalog')
      expect(await detail.json()).toMatchObject({
        items: [{
          id: current.v2.assetId,
          version: { id: current.v2.versionId, number: 2, status: 'verified', contractVersion: 'html-template/v2', isCurrent: true },
          runtime: { mode: 'sandboxed-js', viewport: { width: 1920, height: 1080 }, url: `/api/catalog/assets/${current.v2.assetId}/runtime`, commands: ['replay', 'reset'] },
          derivative: { previewUrl: `/api/catalog/assets/${current.v2.assetId}/preview`, thumbnailUrl: `/api/catalog/assets/${current.v2.assetId}/thumbnail` },
        }],
      })

      const response = await current.app.request(path)
      expect(response.status).toBe(200)
      for (const [name, value] of Object.entries(TEMPLATE_RUNTIME_STATIC_RESPONSE_HEADERS)) expect(response.headers.get(name)).toBe(value)
      expect(response.headers.get(TEMPLATE_RUNTIME_MODE_HEADER)).toBe('sandboxed-js')
      expect(response.headers.get(TEMPLATE_RUNTIME_PROTOCOL_HEADER)).toBe(TEMPLATE_RUNTIME_PROTOCOL)
      expect(response.headers.get(TEMPLATE_RUNTIME_SESSION_HEADER)).toMatch(/^[0-9a-f]{32}$/)
      expect(templateRuntimeNonceFromCsp(response.headers.get('content-security-policy'))).not.toBeNull()
      expect(response.headers.get('set-cookie')).toBeNull()
      const html = Buffer.from(await response.arrayBuffer())
      expect(Number(response.headers.get('content-length'))).toBe(html.byteLength)
      expect(html.toString('utf8')).not.toMatch(/<script\b[^>]*\bsrc\s*=|<link\b|https?:|file:/i)

      expect((await current.app.request(`${path}?source=https://example.test`)).status).toBe(400)
      expect((await current.app.request('http://127.0.0.1:3001/api/catalog/assets/missing/runtime')).status).toBe(404)
      current.database.prepare("UPDATE template_assets SET status = 'retired' WHERE id = ?").run(current.v2.assetId)
      expect((await current.app.request(path)).status).toBe(404)
      current.database.prepare("UPDATE template_assets SET status = 'active' WHERE id = ?").run(current.v2.assetId)

      const contentRow = current.database.prepare('SELECT relative_path FROM content_objects WHERE digest = ?').get(allowlistedV2Digest) as { relative_path: string }
      writeFileSync(join(current.store.root, contentRow.relative_path), 'tampered')
      expect((await current.app.request(path)).status).toBe(409)
    } finally {
      current.database.close()
      rmSync(current.root, { recursive: true, force: true })
    }
  })

  it('refuses a current html-template/v2 object whose normalized digest is not reviewed', async () => {
    const current = state()
    try {
      const unreviewed = structuredClone(interactiveSource())
      unreviewed.manifest.id = 'unreviewed-runtime'
      unreviewed.manifest.version = 1
      unreviewed.manifest.title = 'Unreviewed runtime'
      unreviewed.manifest.summary = 'Repository-local negative runtime fixture'
      const registered = current.repository.registerTemplate(adaptTemplatePackageSource(unreviewed), { promote: true })
      expect(registered.sourceDigest).not.toBe(allowlistedV2Digest)
      const response = await current.app.request(`http://127.0.0.1:3001/api/catalog/assets/${registered.assetId}/runtime`)
      expect(response.status).toBe(404)
    } finally {
      current.database.close()
      rmSync(current.root, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!chromiumExecutablePath)('P02 real Chromium v2 preview worker', () => {
  it('keeps the unrestricted second listener at zero hits and the opaque runtime session bound before promotion', async () => {
    const current = state()
    try {
      const jobs = new LocalJobRepository(current.database as never)
      jobs.enqueue({
        id: 'p02-interactive-preview',
        type: TEMPLATE_PREVIEW_JOB_TYPE,
        inputSnapshot: { templateVersionId: current.v2.versionId, contentObjectDigest: current.v2.contentObject.digest },
        inputRevision: 2,
        maxAttempts: 2,
      })
      const renderer = new SecurePreviewRenderer({ chromiumExecutablePath, navigationTimeoutMs: 20_000 })
      const worker = new TemplatePreviewJobWorker(current.database as never, jobs, current.store, renderer, 'p02-chromium', 60_000)
      await expect(worker.runOnce()).resolves.toBe(true)
      expect(jobs.get('p02-interactive-preview')).toMatchObject({ status: 'succeeded', attempt: 1 })
      expect(current.database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(current.v2.assetId)).toEqual({ current_version_id: current.v2.versionId })

      const derivatives = current.database.prepare('SELECT kind, source_digest, content_digest, renderer_version, security_diagnostic FROM template_preview_derivatives WHERE template_version_id = ? ORDER BY kind').all(current.v2.versionId) as Array<{ kind: string; source_digest: string; content_digest: string; renderer_version: string; security_diagnostic: string }>
      expect(derivatives.map((row) => row.kind)).toEqual(['preview', 'thumbnail'])
      expect(new Set(derivatives.map((row) => row.source_digest))).toEqual(new Set([allowlistedV2Digest]))
      expect(derivatives.every((row) => /^p02-chromium-v2:/.test(row.renderer_version))).toBe(true)
      const diagnostic = JSON.parse(derivatives[0].security_diagnostic) as Record<string, unknown>
      expect(diagnostic).toMatchObject({
        blockedRequestCount: 0,
        blockedSecurityEventCount: 0,
        cookieHeaderCount: 0,
        contextCookieCount: 0,
        documentCookiePresent: false,
        forbiddenDomNodeCount: 0,
        newWindowCount: 0,
        runtimeOpaqueOrigin: true,
        templateOpaqueOrigin: true,
        cookieAccessBlocked: true,
        localStorageAccessBlocked: true,
        sessionStorageAccessBlocked: true,
        parentDomAccessBlocked: true,
        topLocationAccessBlocked: true,
        popupAccessBlocked: true,
        topNavigationBlocked: true,
        networkAccessBlocked: true,
        networkAuditHitCount: 0,
        selfNavigationAuditHitCount: 0,
        selfNavigationBlocked: true,
        runtimeContextBound: true,
        commandProtocolBound: true,
        forgedCommandRejected: true,
        allowScriptsOnlySandbox: true,
      })
      for (const derivative of derivatives) {
        const png = current.store.read(derivative.content_digest)
        expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual(derivative.kind === 'preview' ? { width: 1280, height: 720 } : { width: 320, height: 180 })
      }
      expect((await current.app.request(`http://127.0.0.1:3001/api/catalog/assets/${current.v2.assetId}/runtime`)).status).toBe(200)
    } finally {
      current.database.close()
      rmSync(current.root, { recursive: true, force: true })
    }
  }, 60_000)
})
