import type { RequestHandler } from './$types'
import { forwardJson } from '$lib/server/bff'

const TRANSFER_ID = /^transfer-[0-9a-f]{64}$/

export const POST: RequestHandler = async (event) => {
  if (!TRANSFER_ID.test(event.params.transferId) || event.url.search) {
    return Response.json({ error: '无效的目录传输应用请求' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    return await forwardJson(event, `/api/admin/catalog-transfers/${event.params.transferId}/apply`)
  } catch {
    return Response.json({ error: '无法连接本机目录传输服务' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
