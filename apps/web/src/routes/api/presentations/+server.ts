import type { RequestHandler } from './$types'
import { forwardJson } from '$lib/server/bff'

export const GET: RequestHandler = async (event) => event.url.search ? Response.json({ error: '汇报请求不接受查询参数' }, { status: 400 }) : forward(event, '/api/presentations')
export const POST: RequestHandler = async (event) => event.url.search ? Response.json({ error: '汇报请求不接受查询参数' }, { status: 400 }) : forward(event, '/api/presentations')

async function forward(event: Parameters<RequestHandler>[0], path: string): Promise<Response> {
  try { return await forwardJson(event, path) }
  catch { return Response.json({ error: '无法连接本机汇报服务' }, { status: 502 }) }
}
