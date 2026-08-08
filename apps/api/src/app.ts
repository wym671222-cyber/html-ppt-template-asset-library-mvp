import { Hono } from 'hono'
import { AssetLibraryCatalog, CatalogRequestError, parseCatalogQuery } from './assets/library-catalog.js'
import { getOwnerContext } from './owner.js'
import { PresentationRepository, PresentationRequestError } from './presentations/presentation-repository.js'
import { ExportRequestError, PresentationExportRepository } from './presentation-exports/presentation-export-repository.js'

export const LOOPBACK_HOST = '127.0.0.1'
const allowedOriginSet = new Set(['http://127.0.0.1:5173', 'http://localhost:5173'])

function isLoopbackHostname(value: string): boolean {
  return value === '127.0.0.1' || value === 'localhost'
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:' && allowedOriginSet.has(parsed.origin) && isLoopbackHostname(parsed.hostname)
  } catch {
    return false
  }
}

const MAX_JSON_BYTES = 16_384

async function jsonBody(context: { req: { text(): Promise<string> } }): Promise<Record<string, unknown>> {
  const text = await context.req.text()
  if (!text || text.length > MAX_JSON_BYTES) throw new PresentationRequestError('JSON request body is invalid or too large')
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch {
    throw new PresentationRequestError('JSON request body is invalid or too large')
  }
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

function assertOnlyKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(body).sort().join(',') !== [...keys].sort().join(',')) throw new ExportRequestError(`JSON request body must contain only ${keys.join(' and ')}`)
}

export function createApp(options: { catalog?: AssetLibraryCatalog; presentations?: PresentationRepository; exports?: PresentationExportRepository } = {}): Hono {
  const app = new Hono()
  const catalog = options.catalog
  const presentations = options.presentations
  const exports = options.exports

  app.use('*', async (context, next) => {
    const host = context.req.header('host') ?? new URL(context.req.url).host
    const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':', 1)[0]
    if (!isLoopbackHostname(hostname)) return context.json({ error: 'Loopback Host required' }, 421)

    const origin = context.req.header('origin')
    if (origin && !isAllowedOrigin(origin)) return context.json({ error: 'Loopback Origin required' }, 403)

    if (context.req.method === 'OPTIONS') {
      if (!origin) return context.json({ error: 'Origin required for preflight' }, 403)
      context.header('Access-Control-Allow-Origin', origin)
      context.header('Vary', 'Origin')
      context.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
      return context.body(null, 204)
    }

    await next()
    if (origin) {
      context.header('Access-Control-Allow-Origin', origin)
      context.header('Vary', 'Origin')
    }
  })

  app.get('/', (context) => context.json({ name: 'html-report-asset-library', status: 'p08-offline-export' }))
  app.get('/api/health', (context) => context.json({ status: 'ok', scope: 'loopback-only' }))
  app.get('/api/owner', (context) => context.json({ owner: getOwnerContext() }))
  app.get('/api/catalog', (context) => {
    if (!catalog) return context.json({ error: 'Catalog service unavailable' }, 503)
    try {
      return context.json(catalog.list(getOwnerContext(), parseCatalogQuery(context.req.url)))
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
      const content = catalog.readDerivative(getOwnerContext(), context.req.param('assetId'), kind)
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
    try { return context.json({ owner: getOwnerContext(), presentations: presentations.list(getOwnerContext()) }) } catch (error) { return presentationError(context, error) }
  })
  app.post('/api/presentations', async (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try { return context.json({ presentation: presentations.create(getOwnerContext(), (await jsonBody(context)).name) }, 201) } catch (error) { return presentationError(context, error) }
  })
  app.get('/api/presentations/:presentationId', (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try { return context.json({ presentation: presentations.read(getOwnerContext(), context.req.param('presentationId')) }) } catch (error) { return presentationError(context, error) }
  })
  app.get('/api/presentations/:presentationId/exports', (context) => {
    if (!exports) return context.json({ error: 'Export service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Export query parameters are not accepted' }, 400)
    try { return context.json({ owner: getOwnerContext(), exports: exports.list(getOwnerContext(), context.req.param('presentationId')) }) } catch (error) { return exportError(context, error) }
  })
  app.post('/api/presentations/:presentationId/exports', async (context) => {
    if (!exports) return context.json({ error: 'Export service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Export query parameters are not accepted' }, 400)
    try {
      const body = await jsonBody(context)
      assertOnlyKeys(body, ['expectedRevision', 'itemIds'])
      const result = exports.create(getOwnerContext(), context.req.param('presentationId'), body.expectedRevision, body.itemIds)
      return context.json({ export: result.summary, manifest: result.manifest }, result.created ? 201 : 200)
    } catch (error) { return exportError(context, error) }
  })
  app.get('/api/presentations/:presentationId/exports/:exportId/manifest', (context) => {
    if (!exports) return context.json({ error: 'Export service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Export query parameters are not accepted' }, 400)
    try { return context.json({ manifest: exports.readManifest(getOwnerContext(), context.req.param('presentationId'), context.req.param('exportId')) }) } catch (error) { return exportError(context, error) }
  })
  app.get('/api/presentations/:presentationId/exports/:exportId/html', (context) => {
    if (!exports) return context.json({ error: 'Export service unavailable' }, 503)
    if (new URL(context.req.url).search) return context.json({ error: 'Export query parameters are not accepted' }, 400)
    try {
      const content = exports.readArtifact(getOwnerContext(), context.req.param('presentationId'), context.req.param('exportId'), 'html')
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
      const content = exports.readArtifact(getOwnerContext(), context.req.param('presentationId'), context.req.param('exportId'), 'zip')
      context.header('Content-Type', 'application/zip')
      context.header('Content-Length', String(content.byteLength))
      context.header('Content-Disposition', `attachment; filename="${context.req.param('exportId')}.zip"`)
      context.header('Cache-Control', 'no-store')
      context.header('X-Content-Type-Options', 'nosniff')
      return context.body(new Uint8Array(content))
    } catch (error) { return exportError(context, error) }
  })
  app.patch('/api/presentations/:presentationId', async (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try { const body = await jsonBody(context); return context.json({ presentation: presentations.rename(getOwnerContext(), context.req.param('presentationId'), body.name, body.expectedRevision) }) } catch (error) { return presentationError(context, error) }
  })
  app.post('/api/presentations/:presentationId/items', async (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try { const body = await jsonBody(context); return context.json({ presentation: presentations.add(getOwnerContext(), context.req.param('presentationId'), body.templateVersionId, body.expectedRevision, body.position) }, 201) } catch (error) { return presentationError(context, error) }
  })
  app.post('/api/presentations/:presentationId/items/:itemId/copy', async (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try { const body = await jsonBody(context); return context.json({ presentation: presentations.copy(getOwnerContext(), context.req.param('presentationId'), context.req.param('itemId'), body.expectedRevision, body.position) }, 201) } catch (error) { return presentationError(context, error) }
  })
  app.patch('/api/presentations/:presentationId/items/:itemId', async (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try {
      const body = await jsonBody(context)
      const hasPosition = Object.hasOwn(body, 'position')
      const hasOverrides = Object.hasOwn(body, 'slotOverrides')
      if (hasPosition === hasOverrides) throw new PresentationRequestError('Provide exactly one of position or slotOverrides')
      const presentation = hasPosition
        ? presentations.move(getOwnerContext(), context.req.param('presentationId'), context.req.param('itemId'), body.position, body.expectedRevision)
        : presentations.reviseOverrides(getOwnerContext(), context.req.param('presentationId'), context.req.param('itemId'), body.slotOverrides, body.expectedRevision)
      return context.json({ presentation })
    } catch (error) { return presentationError(context, error) }
  })
  app.delete('/api/presentations/:presentationId/items/:itemId', async (context) => {
    if (!presentations) return context.json({ error: 'Presentation service unavailable' }, 503)
    try { const body = await jsonBody(context); return context.json({ presentation: presentations.remove(getOwnerContext(), context.req.param('presentationId'), context.req.param('itemId'), body.expectedRevision) }) } catch (error) { return presentationError(context, error) }
  })
  app.notFound((context) => context.json({ error: 'Not found' }, 404))

  return app
}
