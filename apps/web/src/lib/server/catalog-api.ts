import { env } from '$env/dynamic/private'

export function catalogApiBaseUrl(): string {
  const value = env.P06_API_URL ?? 'http://127.0.0.1:3001'
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:'
    || (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost')
    || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('P06_API_URL must be a plain loopback HTTP origin')
  }
  return parsed.origin
}

export async function forwardCatalogJson(target: URL): Promise<Response> {
  const response = await fetch(target, { method: 'GET', redirect: 'error' })
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) return Response.json({ error: 'Catalog API returned an invalid media type' }, { status: 502 })
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

export async function forwardPresentationJson(request: Request, target: URL): Promise<Response> {
  const method = request.method
  const headers = new Headers()
  if (method !== 'GET') headers.set('Content-Type', 'application/json')
  const body = method === 'GET' ? undefined : await request.text()
  const response = await fetch(target, { method, headers, body, redirect: 'error' })
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) return Response.json({ error: 'Presentation API returned an invalid media type' }, { status: 502 })
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}
