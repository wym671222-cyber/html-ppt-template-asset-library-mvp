import type { RequestHandler } from './$types'
import { forwardJson } from '$lib/server/bff'

const SEGMENT = /^[a-z0-9-]+$/

export const GET: RequestHandler = async (event) => event.url.search ? Response.json({ error: '汇报请求不接受查询参数' }, { status: 400 }) : forward(event, event.params.path)
export const POST: RequestHandler = async (event) => event.url.search ? Response.json({ error: '汇报请求不接受查询参数' }, { status: 400 }) : forward(event, event.params.path)
export const PATCH: RequestHandler = async (event) => event.url.search ? Response.json({ error: '汇报请求不接受查询参数' }, { status: 400 }) : forward(event, event.params.path)
export const DELETE: RequestHandler = async (event) => event.url.search ? Response.json({ error: '汇报请求不接受查询参数' }, { status: 400 }) : forward(event, event.params.path)

async function forward(event: Parameters<RequestHandler>[0], path: string): Promise<Response> {
  const segments = path.split('/')
  if (!segments.length || segments.length > 5 || segments.some((segment) => !SEGMENT.test(segment))) return Response.json({ error: '无效的汇报请求路径' }, { status: 400 })
  try { return await forwardJson(event, `/api/presentations/${segments.map(encodeURIComponent).join('/')}`) }
  catch { return Response.json({ error: '无法连接本机汇报服务' }, { status: 502 }) }
}
