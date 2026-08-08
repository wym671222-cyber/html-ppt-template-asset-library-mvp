import type { RequestHandler } from './$types'
import { catalogApiBaseUrl, forwardRecoveryJson } from '$lib/server/catalog-api'

export const GET: RequestHandler = async ({ request, url }) => {
  if (url.search) return Response.json({ error: '恢复请求不接受查询参数' }, { status: 400 })
  try { return await forwardRecoveryJson(request, new URL('/api/recovery', catalogApiBaseUrl())) }
  catch { return Response.json({ error: '无法连接本机恢复服务' }, { status: 502 }) }
}
