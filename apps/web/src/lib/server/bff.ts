import { env } from '$env/dynamic/private'
import type { RequestEvent } from '@sveltejs/kit'
import { normalizedClientAddress, readBoundedBody, trustedApiHeaders, validateBrowserWrite } from './bff-boundary.js'

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

export function apiBaseUrl(): string {
  const parsed = new URL(env.P06_API_URL ?? 'http://127.0.0.1:3001')
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('P06_API_URL must be a plain loopback HTTP origin')
  }
  return parsed.origin
}

function isPocketBayOrigin(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.origin === value
      && parsed.protocol === 'https:'
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.pocketbay\.app$/.test(parsed.hostname)
      && parsed.pathname === '/'
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
  } catch {
    return false
  }
}

function configuredOrigin(): string {
  const value = env.ORIGIN ?? 'http://127.0.0.1:5173'
  const parsed = new URL(value)
  if (value === 'https://ppt.ajjy-ai.site') return value
  if (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.pathname === '/' && !parsed.search && !parsed.hash && !parsed.username && !parsed.password) return value
  throw new Error('ORIGIN must be the production Origin or an explicit loopback Origin')
}

export function writeOrigin(event?: Pick<RequestEvent, 'url'>): string {
  if (env.POCKETBAY_RUNTIME === 'true' && event) {
    const value = event.url.origin
    if (isPocketBayOrigin(value)) return value
    throw new Error('PocketBay requests must use an https://*.pocketbay.app Origin')
  }
  return configuredOrigin()
}

function browserWriteOrigin(event: Pick<RequestEvent, 'url'>): string {
  const value = env.POCKETBAY_RUNTIME === 'true' ? writeOrigin(event) : (env.P15_BROWSER_ORIGIN ?? configuredOrigin())
  const parsed = new URL(value)
  if (value === 'https://ppt.ajjy-ai.site') return value
  if (env.POCKETBAY_RUNTIME === 'true' && isPocketBayOrigin(value)) return value
  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && ['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.pathname === '/' && !parsed.search && !parsed.hash && !parsed.username && !parsed.password) return value
  throw new Error('P15_BROWSER_ORIGIN must be the production Origin or an explicit loopback test Origin')
}

export { normalizedClientAddress } from './bff-boundary.js'

function clientAddress(event: RequestEvent): string {
  try {
    return normalizedClientAddress(event.getClientAddress())
  } catch {
    return '127.0.0.1'
  }
}

async function writeBody(event: RequestEvent): Promise<string | Response> {
  const rejected = validateBrowserWrite(event.request.headers, browserWriteOrigin(event))
  if (rejected) return rejected
  return readBoundedBody(event.request.body)
}

function apiHeaders(event: RequestEvent, method: string): Headers {
  // `trustedApiHeaders` creates a new list: no browser forwarding header survives.
  return trustedApiHeaders(event.request.headers, clientAddress(event), method, writeOrigin(event))
}

export async function forwardJson(event: RequestEvent, pathname: string): Promise<Response> {
  const target = new URL(pathname, apiBaseUrl())
  const method = event.request.method
  const bodyResult = method === 'GET' || method === 'HEAD' ? undefined : await writeBody(event)
  if (bodyResult instanceof Response) return bodyResult
  const response = await fetch(target, { method, headers: apiHeaders(event, method), body: bodyResult, redirect: 'error' })
  const contentType = response.headers.get('content-type') ?? ''
  if (response.status !== 204 && !contentType.toLowerCase().startsWith('application/json')) return Response.json({ error: '本机服务返回了无效响应' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  const headers = new Headers(JSON_HEADERS)
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter((value): value is string => value !== null)
  for (const cookie of setCookies) headers.append('Set-Cookie', cookie)
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) headers.set('Retry-After', retryAfter)
  if (response.status === 204) return new Response(null, { status: 204, headers })
  return new Response(await response.arrayBuffer(), { status: response.status, headers })
}

export async function forwardArtifact(event: RequestEvent, pathname: string, kind: 'png' | 'html' | 'zip'): Promise<Response> {
  const response = await fetch(new URL(pathname, apiBaseUrl()), { method: 'GET', headers: apiHeaders(event, 'GET'), redirect: 'error' })
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  if (!response.ok) {
    if (!contentType.startsWith('application/json')) return Response.json({ error: '本机服务返回了无效响应' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
    return new Response(await response.arrayBuffer(), { status: response.status, headers: JSON_HEADERS })
  }
  const expected = kind === 'png' ? 'image/png' : kind === 'html' ? 'text/html' : 'application/zip'
  if (!contentType.startsWith(expected)) return Response.json({ error: '导出物媒体类型不符合契约' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  const headers = new Headers({ 'Content-Type': kind === 'png' ? 'image/png' : kind === 'html' ? 'text/html; charset=utf-8' : 'application/zip', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  const disposition = response.headers.get('content-disposition')
  if (disposition) headers.set('Content-Disposition', disposition)
  if (kind === 'html') headers.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'")
  return new Response(await response.arrayBuffer(), { status: 200, headers })
}

export async function sessionFromApi(event: RequestEvent): Promise<import('$lib/auth').SessionUser | null> {
  try {
    const response = await fetch(new URL('/api/auth/session', apiBaseUrl()), { method: 'GET', headers: apiHeaders(event, 'GET'), redirect: 'error' })
    if (!response.ok) return null
    const payload = await response.json() as { user?: import('$lib/auth').SessionUser }
    return payload.user ?? null
  } catch { return null }
}
