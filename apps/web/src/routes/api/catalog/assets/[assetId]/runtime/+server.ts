import type { RequestHandler } from './$types'
import { forwardTemplateRuntime } from '$lib/server/bff'

const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const GET: RequestHandler = async (event) => {
  const { params, url } = event
  if (!ASSET_ID.test(params.assetId) || url.search) {
    return Response.json({ error: '无效的交互模板运行页请求' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    return await forwardTemplateRuntime(event, `/api/catalog/assets/${encodeURIComponent(params.assetId)}/runtime`)
  } catch {
    return Response.json({ error: '无法连接本机交互模板运行页服务' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
