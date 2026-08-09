import type { Handle } from '@sveltejs/kit'

// Deployed on a public domain (ppt.ajjy-ai.site) behind Caddy.
// The original loopback-only guard is intentionally removed so the app
// can be served from a real hostname; CSP and route whitelist remain.
export const handle: Handle = async ({ event, resolve }) => {
  const catalogRoute = event.url.pathname === '/api/catalog' || event.url.pathname.startsWith('/api/catalog/assets/')
  const presentationRoute = event.url.pathname === '/api/presentations' || event.url.pathname.startsWith('/api/presentations/')
  const recoveryRoute = event.url.pathname === '/api/recovery' || event.url.pathname.startsWith('/api/recovery/')
  // Only the P09 asset-library root and its exact catalog/presentation/export/recovery proxies, and
  // generated app assets are active. Legacy routes remain unreachable history.
  if (event.url.pathname !== '/' && !event.url.pathname.startsWith('/_app/') && !catalogRoute && !presentationRoute && !recoveryRoute) {
    return new Response('Not found', { status: 404 })
  }
  if (catalogRoute && event.request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  if (presentationRoute && !['GET', 'POST', 'PATCH', 'DELETE'].includes(event.request.method)) return new Response('Method not allowed', { status: 405 })
  if (recoveryRoute && !['GET', 'POST'].includes(event.request.method)) return new Response('Method not allowed', { status: 405 })

  const response = await resolve(event)
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'none'")
  return response
}
