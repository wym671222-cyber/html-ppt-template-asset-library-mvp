import type { RequestHandler } from './$types'
import { catalogApiBaseUrl } from '$lib/server/catalog-api'

async function health(kind: string): Promise<Response> {
  if (kind !== 'live' && kind !== 'ready') return Response.json({ error: 'Health check not found' }, { status: 404 })
  try {
    const response = await fetch(new URL(`/api/health/${kind}`, catalogApiBaseUrl()), {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return Response.json({ error: 'Health API returned an invalid media type' }, { status: 502 })
    }
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return Response.json({ error: 'Health API unavailable' }, { status: 502 })
  }
}

export const GET: RequestHandler = async ({ params }) => health(params.kind)
export const HEAD: RequestHandler = async ({ params }) => {
  const response = await health(params.kind)
  return new Response(null, { status: response.status, headers: response.headers })
}
