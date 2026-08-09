import type { RequestHandler } from './$types'
import { forwardJson } from '$lib/server/bff'

const USER_ID = /^user-[0-9a-f-]{36}$/
const ACTIONS = new Set(['approve', 'disable', 'reset-password'])

export const POST: RequestHandler = (event) => {
  if (event.url.search || !USER_ID.test(event.params.userId) || !ACTIONS.has(event.params.action)) return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  return forwardJson(event, `/api/admin/users/${event.params.userId}/${event.params.action}`).catch(() => Response.json({ error: 'AUTH_SERVICE_UNAVAILABLE' }, { status: 502 }))
}
