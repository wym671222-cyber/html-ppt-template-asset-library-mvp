import type { Handle } from '@sveltejs/kit'

function isLoopbackHost(host: string): boolean {
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':', 1)[0]
  return hostname === '127.0.0.1' || hostname === 'localhost'
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const value = new URL(origin)
    return value.protocol === 'http:' && !value.username && !value.password && !value.pathname.replace('/', '') && !value.search && !value.hash && isLoopbackHost(value.host)
  } catch { return false }
}

export const handle: Handle = async ({ event, resolve }) => {
  if (!isLoopbackHost(event.request.headers.get('host') ?? event.url.host)) {
    return new Response('Loopback Host required', { status: 421 })
  }

  const origin = event.request.headers.get('origin')
  if (origin && !isLoopbackOrigin(origin)) {
    return new Response('Loopback Origin required', { status: 403 })
  }

  const catalogRoute = event.url.pathname === '/api/catalog' || event.url.pathname.startsWith('/api/catalog/assets/')
  const presentationRoute = event.url.pathname === '/api/presentations' || event.url.pathname.startsWith('/api/presentations/')
  // Only the P08 asset-library root and its exact catalog/presentation/export proxies, and
  // generated app assets are active. Legacy routes remain unreachable history.
  if (event.url.pathname !== '/' && !event.url.pathname.startsWith('/_app/') && !catalogRoute && !presentationRoute) {
    return new Response('Not found', { status: 404 })
  }
  if (catalogRoute && event.request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  if (presentationRoute && !['GET', 'POST', 'PATCH', 'DELETE'].includes(event.request.method)) return new Response('Method not allowed', { status: 405 })

  const response = await resolve(event)
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'none'")
  return response
}
