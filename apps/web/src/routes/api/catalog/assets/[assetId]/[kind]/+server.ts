import type { RequestHandler } from './$types'
import { forwardArtifact } from '$lib/server/bff'

const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const GET: RequestHandler = async (event) => {
  const { params, url } = event
  if (!ASSET_ID.test(params.assetId) || (params.kind !== 'preview' && params.kind !== 'thumbnail') || url.search) {
    return Response.json({ error: '无效的 PNG 派生物请求' }, { status: 400 })
  }
  try {
    return await forwardArtifact(event, `/api/catalog/assets/${encodeURIComponent(params.assetId)}/${params.kind}`, 'png')
  } catch {
    return Response.json({ error: '无法连接本机 PNG 派生物服务' }, { status: 502 })
  }
}
