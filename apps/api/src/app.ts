import { Hono } from 'hono'
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

export function createApp(): Hono {
  const app = new Hono()

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

  app.get('/', (context) => context.json({ name: 'html-report-asset-library', status: 'p02-foundation' }))
  app.get('/api/health', (context) => context.json({ status: 'ok', scope: 'loopback-only' }))
  app.get('/api/owner', (context) => context.json({ owner: getOwnerContext() }))
  app.notFound((context) => context.json({ error: 'Not found' }, 404))

  return app
}

export const app = createApp()
