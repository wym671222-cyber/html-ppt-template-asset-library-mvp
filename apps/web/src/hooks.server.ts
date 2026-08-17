import type { Handle } from '@sveltejs/kit'
import { redirect } from '@sveltejs/kit'
import { sessionFromApi } from '$lib/server/bff'
import { ASSET_LIBRARY_PAGE_CSP } from '$lib/server/bff-boundary'

// Deployed on a public domain (ppt.ajjy-ai.site) behind Caddy.
// The original loopback-only guard is intentionally removed so the app
// can be served from a real hostname; CSP and route whitelist remain.
export const handle: Handle = async ({ event, resolve }) => {
  const catalogRoute = event.url.pathname === '/api/catalog' || event.url.pathname.startsWith('/api/catalog/assets/')
  const templateRuntimeRoute = /^\/api\/catalog\/assets\/[a-z0-9]+(?:-[a-z0-9]+)*\/runtime$/.test(event.url.pathname)
  const healthRoute = event.url.pathname === '/api/health/live' || event.url.pathname === '/api/health/ready'
  const presentationRoute = event.url.pathname === '/api/presentations' || event.url.pathname.startsWith('/api/presentations/')
  const recoveryRoute = event.url.pathname === '/api/recovery' || event.url.pathname.startsWith('/api/recovery/')
  const templateImportRoute = event.url.pathname === '/api/template-imports' || event.url.pathname.startsWith('/api/template-imports/')
  const authRoute = event.url.pathname === '/api/auth' || event.url.pathname.startsWith('/api/auth/')
  const adminRoute = event.url.pathname === '/api/admin' || event.url.pathname.startsWith('/api/admin/')
  const publicPage = ['/login', '/register', '/pending', '/change-password'].includes(event.url.pathname)
  const businessPage = event.url.pathname === '/' || event.url.pathname === '/admin'
  // Only the P09 asset-library root and its exact catalog/presentation/export/recovery proxies, and
  // generated app assets are active. Legacy routes remain unreachable history.
  if (!businessPage && !publicPage && !event.url.pathname.startsWith('/_app/') && !catalogRoute && !healthRoute && !presentationRoute && !recoveryRoute && !templateImportRoute && !authRoute && !adminRoute) {
    return new Response('Not found', { status: 404 })
  }
  if (catalogRoute && event.request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  if (healthRoute && event.request.method !== 'GET' && event.request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
  if (presentationRoute && !['GET', 'POST', 'PATCH', 'DELETE'].includes(event.request.method)) return new Response('Method not allowed', { status: 405 })
  if (recoveryRoute && !['GET', 'POST'].includes(event.request.method)) return new Response('Method not allowed', { status: 405 })
  if (templateImportRoute && !['GET', 'POST'].includes(event.request.method)) return new Response('Method not allowed', { status: 405 })
  if (authRoute && !['GET', 'POST'].includes(event.request.method)) return new Response('Method not allowed', { status: 405 })
  if (adminRoute && !['GET', 'POST'].includes(event.request.method)) return new Response('Method not allowed', { status: 405 })

  if (businessPage || publicPage) {
    event.locals.user = await sessionFromApi(event)
    const user = event.locals.user
    if (businessPage && !user) throw redirect(303, `/login?next=${encodeURIComponent(event.url.pathname)}`)
    if (event.url.pathname === '/change-password' && !user) throw redirect(303, '/login')
    if (businessPage && user?.mustChangePassword) throw redirect(303, '/change-password')
    if (event.url.pathname === '/admin' && user?.role !== 'admin') throw redirect(303, '/')
    if ((event.url.pathname === '/login' || event.url.pathname === '/register') && user) {
      throw redirect(303, user.mustChangePassword ? '/change-password' : '/')
    }
    if (event.url.pathname === '/pending' && user) throw redirect(303, '/')
  }

  const response = await resolve(event)
  if (templateRuntimeRoute && response.ok && response.headers.get('Content-Type') === 'text/html; charset=utf-8') return response
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('Content-Security-Policy', ASSET_LIBRARY_PAGE_CSP)
  return response
}
