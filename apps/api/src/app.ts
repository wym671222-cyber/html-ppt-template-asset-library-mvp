import { Hono } from 'hono'
import { AssetLibraryCatalog, CatalogRequestError, parseCatalogQuery } from './assets/library-catalog.js'
import { getOwnerContext } from './owner.js'
import { PresentationRepository, PresentationRequestError } from './presentations/presentation-repository.js'

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

export function createApp(options: { catalog?: AssetLibraryCatalog; presentations?: PresentationRepository } = {}): Hono {
  const app = new Hono()
  const catalog = options.catalog
  const presentations = options.presentations

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

  app.get('/', (context) => context.json({ name: 'html-report-asset-library', status: 'p06-asset-library' }))
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
