import type { RequestHandler } from './$types'
import { forwardJson } from '$lib/server/bff'

export const GET: RequestHandler = async (event) => {
  const { url } = event
  if (url.search) return Response.json({ error: '恢复请求不接受查询参数' }, { status: 400 })
  try { return await forwardJson(event, '/api/recovery') }
  catch { return Response.json({ error: '无法连接本机恢复服务' }, { status: 502 }) }
}
