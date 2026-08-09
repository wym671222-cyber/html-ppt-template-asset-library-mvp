import type { RequestHandler } from './$types'
import { forwardJson } from '$lib/server/bff'

const ALLOWED = new Map([
  ['register', new Set(['POST'])],
  ['login', new Set(['POST'])],
  ['logout', new Set(['POST'])],
  ['session', new Set(['GET'])],
  ['change-password', new Set(['POST'])],
])

function forward(event: Parameters<RequestHandler>[0]): Promise<Response> {
  if (event.url.search || !ALLOWED.get(event.params.path)?.has(event.request.method)) return Promise.resolve(Response.json({ error: 'INVALID_REQUEST' }, { status: 400 }))
  return forwardJson(event, `/api/auth/${event.params.path}`).catch(() => Response.json({ error: 'AUTH_SERVICE_UNAVAILABLE' }, { status: 502 }))
}

export const GET: RequestHandler = forward
export const POST: RequestHandler = forward
