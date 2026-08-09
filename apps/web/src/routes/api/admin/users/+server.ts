import type { RequestHandler } from './$types'
import { forwardJson } from '$lib/server/bff'

export const GET: RequestHandler = (event) => {
  const status = event.url.searchParams.get('status')
  if ([...event.url.searchParams.keys()].some((key) => key !== 'status') || event.url.searchParams.getAll('status').length > 1 || (status !== null && !['pending', 'active', 'disabled'].includes(status))) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }
  return forwardJson(event, `/api/admin/users${event.url.search}`).catch(() => Response.json({ error: 'AUTH_SERVICE_UNAVAILABLE' }, { status: 502 }))
}
