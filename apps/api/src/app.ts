import { Hono } from 'hono'
import { AssetLibraryCatalog, CatalogRequestError, parseCatalogQuery } from './assets/library-catalog.js'
import { getOwnerContext } from './owner.js'
import { PresentationRepository, PresentationRequestError } from './presentations/presentation-repository.js'
import { ExportRequestError, PresentationExportRepository } from './presentation-exports/presentation-export-repository.js'
import { LocalRecoveryService, MAX_RECOVERY_ARCHIVE_BYTES, RecoveryRequestError } from './recovery/local-recovery.js'
import { AuthApplicationService } from './auth/service.js'
import { createAuthRouter } from './routes/auth.js'
import { createAdminRouter } from './routes/admin.js'
import { createBusinessAuthMiddleware, type AuthVariables } from './middleware/auth.js'
import { createAdminMiddleware } from './middleware/admin.js'

export const LOOPBACK_HOST = '127.0.0.1'
export const PRODUCTION_APP_ORIGIN = 'https://ppt.ajjy-ai.site'
export const TEST_APP_ORIGINS = Object.freeze(['http://127.0.0.1:5173', 'http://localhost:5173'])
const POCKETBAY_ORIGIN_PATTERN = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.pocketbay\.app$/

function isLoopbackHostname(value: string): boolean {
  return value === '127.0.0.1' || value === 'localhost'
}

export function isPocketBayOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin)
    return parsed.origin === origin
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      && POCKETBAY_ORIGIN_PATTERN.test(parsed.origin)
  } catch {
    return false
  }
}

function isPermittedConfiguredOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin)
    if (parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false
    return parsed.origin === PRODUCTION_APP_ORIGIN || isPocketBayOrigin(origin) || (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))
  } catch {
    return false
  }
}

const MAX_JSON_BYTES = 16_384
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

type ReadinessCheck = () => void | Promise<void>

async function jsonBody(context: { req: { text(): Promise<string> } }): Promise<Record<string, unknown>> {
  const text = await context.req.text()
  if (!text || text.length > MAX_JSON_BYTES) throw new PresentationRequestError('JSON request body is invalid or too large')
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new PresentationRequestError('JSON request body is invalid or too large')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PresentationRequestError('JSON request body is invalid or too large')
  if (Object.hasOwn(parsed, 'owner') || Object.hasOwn(parsed, 'ownerId') || Object.hasOwn(parsed, 'ownerUserId') || Object.hasOwn(parsed, 'userId')) {
    throw new PresentationRequestError('Owner identity is derived from the authenticated session')
  }
  return parsed as Record<string, unknown>
}

async function boundedBinaryBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null && (!/^[0-9]+$/.test(contentLength) || Number(contentLength) > maxBytes)) throw new RecoveryRequestError('Recovery archive size is invalid', 400)
  if (!request.body) throw new RecoveryRequestError('Recovery archive is missing', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new RecoveryRequestError('Recovery archive size is invalid', 400)
      }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  if (size < 22) throw new RecoveryRequestError('Recovery archive size is invalid', 400)
  const content = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength }
  return content
}

function presentationError(context: { json(value: { error: string }, status: 400 | 404 | 409 | 500): Response }, error: unknown): Response {
  if (error instanceof PresentationRequestError) return context.json({ error: error.message }, error.status)
  return context.json({ error: 'Presentation request failed' }, 500)
}

function exportError(context: { json(value: { error: string }, status: 400 | 404 | 409 | 500): Response }, error: unknown): Response {
  if (error instanceof ExportRequestError) return context.json({ error: error.message }, error.status)
  if (error instanceof PresentationRequestError) return context.json({ error: error.message }, error.status)
  return context.json({ error: 'Export request failed' }, 500)
}

function recoveryError(context: { json(value: { error: string }, status: 400 | 404 | 409 | 500): Response }, error: unknown): Response {
  if (error instanceof RecoveryRequestError) return context.json({ error: error.message }, error.status)
  if (error instanceof PresentationRequestError) return context.json({ error: error.message }, error.status)
  return context.json({ error: 'Local recovery request failed' }, 500)
}

function assertOnlyKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(body).sort().join(',') !== [...keys].sort().join(',')) throw new ExportRequestError(`JSON request body must contain only ${keys.join(' and ')}`)
}

function assertOnlyRecoveryKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(body).sort().join(',') !== [...keys].sort().join(',')) throw new RecoveryRequestError(`JSON request body must contain only ${keys.join(' and ')}`, 400)
}

export function createApp(options: {
  catalog?: AssetLibraryCatalog
  presentations?: PresentationRepository
  exports?: PresentationExportRepository
  recovery?: LocalRecoveryService
  auth?: AuthApplicationService
  allowedOrigins?: readonly string[]
  registrationEnabled?: boolean
  readOnly?: boolean
  readiness?: ReadinessCheck
} = {}): Hono<AuthVariables> {
  const app = new Hono<AuthVariables>()
  const catalog = options.catalog
  const presentations = options.presentations
  const exports = options.exports
  const recovery = options.recovery
  const auth = options.auth
  const allowedOrigins = options.allowedOrigins ?? TEST_APP_ORIGINS
  if (allowedOrigins.length === 0 || allowedOrigins.some((origin) => !isPermittedConfiguredOrigin(origin))) throw new Error('Allowed application Origin is invalid')
  const allowedOriginSet = new Set(allowedOrigins)
  const registrationEnabled = options.registrationEnabled ?? true
  const readOnly = options.readOnly ?? false
  const readiness = options.readiness ?? (() => undefined)
  const unavailableAuth = async (context: { header(name: string, value: string): void; json(value: { error: string }, status: 503): Response }) => {
    context.header('Cache-Control', 'no-store')
    return context.json({ error: 'Authentication service unavailable' }, 503)
  }
  const businessAuth = auth ? createBusinessAuthMiddleware(auth, 'business.access') : unavailableAuth
  const recoveryAuth = auth ? createBusinessAuthMiddleware(auth, 'recovery.access') : unavailableAuth
  const recoveryAdmin = auth ? createAdminMiddleware(auth, 'recovery.access') : unavailableAuth

  app.use('*', async (context, next) => {
    const host = context.req.header('host') ?? new URL(context.req.url).host
    const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':', 1)[0]
    if (!isLoopbackHostname(hostname)) return context.json({ error: 'Loopback Host required' }, 421)

    const origin = context.req.header('origin')
    const writeRequest = WRITE_METHODS.has(context.req.method)
    const originAllowed = origin !== undefined && allowedOriginSet.has(origin)
    if ((origin && !originAllowed) || (writeRequest && !origin)) {
      if (auth) auth.recordFailure('security.origin', 'request', 'ORIGIN_REJECTED')
      return context.json({ error: 'Exact Origin required' }, 403)
    }

    if (context.req.method === 'OPTIONS') {
      if (!origin) return context.json({ error: 'Origin required for preflight' }, 403)
      context.header('Access-Control-Allow-Origin', origin)
      context.header('Vary', 'Origin')
      context.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
      return context.body(null, 204)
    }

    if (readOnly && context.req.path.startsWith('/api/') && WRITE_METHODS.has(context.req.method)) {
      context.header('Cache-Control', 'no-store')
      return context.json({ error: 'APP_READ_ONLY' }, 503)
    }

    await next()
    if (origin) {
      context.header('Access-Control-Allow-Origin', origin)
      context.header('Vary', 'Origin')
    }
  })

  app.get('/', (context) => context.json({ name: 'html-report-asset-library', status: 'p09-local-recovery' }))
  app.get('/api/health', (context) => context.json({ status: 'ok', scope: 'loopback-only' }))
  app.get('/api/health/live', (context) => context.json({ status: 'live' }))
  app.get('/api/health/ready', async (context) => {
    try {
      await readiness()
      return context.json({ status: 'ready' })
    } catch {
      context.header('Cache-Control', 'no-store')
      return context.json({ error: 'APP_NOT_READY' }, 503)
    }
  })
  if (auth) {
    app.route('/api/auth', createAuthRouter(auth, { registrationEnabled }))
    app.route('/api/admin', createAdminRouter(auth))
  }
  app.use('/api/owner', businessAuth)
  app.use('/api/catalog', businessAuth)
  app.use('/api/catalog/*', businessAuth)
  app.use('/api/presentations', businessAuth)
  app.use('/api/presentations/*', businessAuth)
  app.use('/api/recovery', recoveryAuth, recoveryAdmin)
  app.use('/api/recovery/*', recoveryAuth, recoveryAdmin)
  app.get('/api/owner', (context) => context.json({ owner: getOwnerContext(context.get('auth').user.id) }))
  app.get('/api/catalog', (context) => {
    if (!catalog) return context.json({ error: 'Catalog service unavailable' }, 503)
    try {
      return context.json(catalog.list(getOwnerContext(context.get('auth').user.id), parseCatalogQuery(context.req.url)))
    } catch (error) {
      if (error instanceof CatalogRequestError) return context.json({ error: error.message }, error.status)
      return context.json({ error: 'Catalog query failed' }, 500)
    }
  })
  app.get('/api/catalog/assets/:assetId/:kind', (context) => {
    if (!catalog) return context.json({ error: 'Catalog service unavailable' }, 503)
    const kind = context.req.param('kind')
    if (kind !== 'preview' && kind !== 'thumbnail') return context.json({ error: 'Derivative kind not found' }, 404)
    if (new URL(context.req.url).search) return context.json({ error: 'Derivative query parameters are not accepted' }, 400)
    try {
      const content = catalog.readDerivative(getOwnerContext(context.get('auth').user.id), context.req.param('assetId'), kind)
      context.header('Content-Type', 'image/png')
      context.header('Content-Length', String(content.byteLength))
      context.header('Cache-Control', 'no-store')
      context.header('X-Content-Type-Options', 'nosniff')
      return context.body(new Uint8Array(content))
    } catch (error) {
      if (error instanceof CatalogRequestError) return context.json({ error: error.message }, error.status)
      return context.json({ error: 'Derivative read failed' }, 500)
    }
  })
  app.get('/api/presentations', (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    const owner = getOwnerContext(context.get('auth').user.id)
    try { return context.json({ owner, presentations: presentations.list(owner) }) } catch (error) { return presentationError(context, error) }
  })
  app.post('/api/presentations', async (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try { return context.json({ presentation: presentations.create(getOwnerContext(context.get('auth').user.id), (await jsonBody(context)).name) }, 201) } catch (error) { return presentationError(context, error) }
  })
  app.get('/api/presentations/:presentationId', (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try { return context.json({ presentation: presentations.read(getOwnerContext(context.get('auth').user.id), context.req.param('presentationId')) }) } catch (error) { return presentationError(context, error) }
  })
  app.get('/api/presentations/:presentationId/exports', (context) => {
    if (!exports) return context.json({ error: 'Export service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Export query parameters are not accepted' }, 400)
    const owner = getOwnerContext(context.get('auth').user.id)
    try { return context.json({ owner, exports: exports.list(owner, context.req.param('presentationId')) }) } catch (error) { return exportError(context, error) }
  })
  app.post('/api/presentations/:presentationId/exports', async (context) => {
    if (!exports) return context.json({ error: 'Export service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Export query parameters are not accepted' }, 400)
    try {
      const body = await jsonBody(context)
      assertOnlyKeys(body, ['expectedRevision', 'itemIds'])
      const result = exports.create(getOwnerContext(context.get('auth').user.id), context.req.param('presentationId'), body.expectedRevision, body.itemIds)
      return context.json({ export: result.summary, manifest: result.manifest }, result.created ? 201 : 200)
    } catch (error) { return exportError(context, error) }
  })
  app.get('/api/presentations/:presentationId/exports/:exportId/manifest', (context) => {
    if (!exports) return context.json({ error: 'Export service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Export query parameters are not accepted' }, 400)
    try { return context.json({ manifest: exports.readManifest(getOwnerContext(context.get('auth').user.id), context.req.param('presentationId'), context.req.param('exportId')) }) } catch (error) { return exportError(context, error) }
  })
  app.get('/api/presentations/:presentationId/exports/:exportId/html', (context) => {
    if (!exports) return context.json({ error: 'Export service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Export query parameters are not accepted' }, 400)
    try {
      const content = exports.readArtifact(getOwnerContext(context.get('auth').user.id), context.req.param('presentationId'), context.req.param('exportId'), 'html')
      context.header('Content-Type', 'text/html; charset=utf-8')
      context.header('Content-Length', String(content.byteLength))
      context.header('Content-Disposition', `attachment; filename="${context.req.param('exportId')}.html"`)
      context.header('Cache-Control', 'no-store')
      context.header('X-Content-Type-Options', 'nosniff')
      context.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'")
      return context.body(new Uint8Array(content))
    } catch (error) { return exportError(context, error) }
  })
  app.get('/api/presentations/:presentationId/exports/:exportId/zip', (context) => {
    if (!exports) return context.json({ error: 'Export service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Export query parameters are not accepted' }, 400)
    try {
      const content = exports.readArtifact(getOwnerContext(context.get('auth').user.id), context.req.param('presentationId'), context.req.param('exportId'), 'zip')
      context.header('Content-Type', 'application/zip')
      context.header('Content-Length', String(content.byteLength))
      context.header('Content-Disposition', `attachment; filename="${context.req.param('exportId')}.zip"`)
      context.header('Cache-Control', 'no-store')
      context.header('X-Content-Type-Options', 'nosniff')
      return context.body(new Uint8Array(content))
    } catch (error) { return exportError(context, error) }
  })
  app.get('/api/recovery', (context) => {
    if (!recovery) return context.json({ error: 'Recovery service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Recovery query parameters are not accepted' }, 400)
    try { return context.json({ recovery: recovery.inspectCurrent() }) } catch (error) { return recoveryError(context, error) }
  })
  app.post('/api/recovery/backups', async (context) => {
    if (!recovery) return context.json({ error: 'Recovery service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Recovery query parameters are not accepted' }, 400)
    try {
      const body = await jsonBody(context)
      assertOnlyRecoveryKeys(body, ['expectedStateSha256'])
      return context.json({ backup: await recovery.createBackup(body.expectedStateSha256) }, 201)
    } catch (error) { return recoveryError(context, error) }
  })
  app.get('/api/recovery/backups/:backupId/manifest', (context) => {
    if (!recovery) return context.json({ error: 'Recovery service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Recovery query parameters are not accepted' }, 400)
    try { return context.json(recovery.readBackupManifest(context.req.param('backupId'))) } catch (error) { return recoveryError(context, error) }
  })
  app.get('/api/recovery/backups/:backupId/archive', (context) => {
    if (!recovery) return context.json({ error: 'Recovery service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Recovery query parameters are not accepted' }, 400)
    try {
      const content = recovery.readBackupArchive(context.req.param('backupId'))
      context.header('Content-Type', 'application/zip')
      context.header('Content-Length', String(content.byteLength))
      context.header('Content-Disposition', `attachment; filename="${context.req.param('backupId')}.zip"`)
      context.header('Cache-Control', 'no-store')
      context.header('X-Content-Type-Options', 'nosniff')
      return context.body(new Uint8Array(content))
    } catch (error) { return recoveryError(context, error) }
  })
  app.post('/api/recovery/backups/import', async (context) => {
    if (!recovery) return context.json({ error: 'Recovery service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Recovery query parameters are not accepted' }, 400)
    if ((context.req.header('content-type') ?? '').toLowerCase().trim() !== 'application/zip') return context.json({ error: 'Recovery archive Content-Type must be application/zip' }, 400)
    try {
      const content = await boundedBinaryBody(context.req.raw, MAX_RECOVERY_ARCHIVE_BYTES)
      return context.json({ backup: recovery.importBackupArchive(content) }, 201)
    } catch (error) { return recoveryError(context, error) }
  })
  app.post('/api/recovery/backups/:backupId/restore', async (context) => {
    if (!recovery) return context.json({ error: 'Recovery service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Recovery query parameters are not accepted' }, 400)
    try {
      const body = await jsonBody(context)
      assertOnlyRecoveryKeys(body, ['expectedManifestSha256'])
      return context.json({ restore: recovery.restoreBackup(context.req.param('backupId'), body.expectedManifestSha256) }, 201)
    } catch (error) { return recoveryError(context, error) }
  })
  app.post('/api/recovery/backups/:backupId/activate', async (context) => {
    if (!recovery) return context.json({ error: 'Recovery service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Recovery query parameters are not accepted' }, 400)
    try {
      const body = await jsonBody(context)
      assertOnlyRecoveryKeys(body, ['expectedManifestSha256', 'confirmation'])
      return context.json({ activation: recovery.stageActivation(context.req.param('backupId'), body.expectedManifestSha256, body.confirmation) }, 202)
    } catch (error) { return recoveryError(context, error) }
  })
  app.patch('/api/presentations/:presentationId', async (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try { const body = await jsonBody(context); return context.json({ presentation: presentations.rename(getOwnerContext(context.get('auth').user.id), context.req.param('presentationId'), body.name, body.expectedRevision) }) } catch (error) { return presentationError(context, error) }
  })
  app.post('/api/presentations/:presentationId/items', async (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try { const body = await jsonBody(context); return context.json({ presentation: presentations.add(getOwnerContext(context.get('auth').user.id), context.req.param('presentationId'), body.templateVersionId, body.expectedRevision, body.position) }, 201) } catch (error) { return presentationError(context, error) }
  })
  app.post('/api/presentations/:presentationId/items/:itemId/copy', async (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try { const body = await jsonBody(context); return context.json({ presentation: presentations.copy(getOwnerContext(context.get('auth').user.id), context.req.param('presentationId'), context.req.param('itemId'), body.expectedRevision, body.position) }, 201) } catch (error) { return presentationError(context, error) }
  })
  app.patch('/api/presentations/:presentationId/items/:itemId', async (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try {
      const body = await jsonBody(context)
      const hasPosition = Object.hasOwn(body, 'position')
      const hasOverrides = Object.hasOwn(body, 'slotOverrides')
      if (hasPosition === hasOverrides) throw new PresentationRequestError('Provide exactly one of position or slotOverrides')
      const presentation = hasPosition
        ? presentations.move(getOwnerContext(context.get('auth').user.id), context.req.param('presentationId'), context.req.param('itemId'), body.position, body.expectedRevision)
        : presentations.reviseOverrides(getOwnerContext(context.get('auth').user.id), context.req.param('presentationId'), context.req.param('itemId'), body.slotOverrides, body.expectedRevision)
      return context.json({ presentation })
    } catch (error) { return presentationError(context, error) }
  })
  app.delete('/api/presentations/:presentationId/items/:itemId', async (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try { const body = await jsonBody(context); return context.json({ presentation: presentations.remove(getOwnerContext(context.get('auth').user.id), context.req.param('presentationId'), context.req.param('itemId'), body.expectedRevision) }) } catch (error) { return presentationError(context, error) }
  })
  app.notFound((context) => context.json({ error: 'Not found' }, 404))

  return app
}
