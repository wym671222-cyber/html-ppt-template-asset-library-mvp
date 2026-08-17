import type { RequestHandler } from './$types'
import { forwardArtifact } from '$lib/server/bff'

export const GET: RequestHandler = async (event) => {
  if (event.url.search) return Response.json({ error: '目录传输导出不接受查询参数' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  try {
    return await forwardArtifact(event, '/api/admin/catalog-transfers/export', 'zip')
  } catch {
    return Response.json({ error: '无法连接本机目录传输服务' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
