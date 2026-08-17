import type { RequestHandler } from './$types'
import { forwardBinary } from '$lib/server/bff'

const MAX_CATALOG_TRANSFER_ARCHIVE_BYTES = 64 * 1024 * 1024

export const POST: RequestHandler = async (event) => {
  if (event.url.search) return Response.json({ error: '目录传输上传不接受查询参数' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  try {
    return await forwardBinary(event, '/api/admin/catalog-transfers', 'application/zip', MAX_CATALOG_TRANSFER_ARCHIVE_BYTES)
  } catch {
    return Response.json({ error: '无法连接本机目录传输服务' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
