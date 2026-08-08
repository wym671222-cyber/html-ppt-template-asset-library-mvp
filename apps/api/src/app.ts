import { Hono } from 'hono'
import { AssetLibraryCatalog, CatalogRequestError, parseCatalogQuery } from './assets/library-catalog.js'
import { getOwnerContext } from './owner.js'

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

export function createApp(options: { catalog?: AssetLibraryCatalog } = {}): Hono {
  const app = new Hono()
  const catalog = options.catalog

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
      context.header('Access-Control-Allow-Methods', 'GET, OPTIONS')
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
  app.notFound((context) => context.json({ error: 'Not found' }, 404))

  return app
}
