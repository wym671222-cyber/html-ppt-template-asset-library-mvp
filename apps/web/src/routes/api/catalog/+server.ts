import type { RequestHandler } from './$types'
import { forwardJson } from '$lib/server/bff'

export const GET: RequestHandler = (event) => forwardJson(event, `/api/catalog${event.url.search}`).catch(() => Response.json({ error: '无法连接本机资产目录服务' }, { status: 502 }))
