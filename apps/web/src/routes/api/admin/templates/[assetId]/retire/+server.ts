import type { RequestHandler } from './$types'
import { forwardJson } from '$lib/server/bff'

const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const POST: RequestHandler = async (event) => {
  if (!ASSET_ID.test(event.params.assetId) || event.url.search) {
    return Response.json({ error: '无效的模板下架请求' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    return await forwardJson(event, `/api/admin/templates/${encodeURIComponent(event.params.assetId)}/retire`)
  } catch {
    return Response.json({ error: '无法连接本机模板管理服务' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
