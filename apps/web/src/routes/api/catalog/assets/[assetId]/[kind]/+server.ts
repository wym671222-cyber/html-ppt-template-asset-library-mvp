import type { RequestHandler } from './$types'
import { catalogApiBaseUrl } from '$lib/server/catalog-api'

const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const GET: RequestHandler = async ({ params, url }) => {
  if (!ASSET_ID.test(params.assetId) || (params.kind !== 'preview' && params.kind !== 'thumbnail') || url.search) {
    return Response.json({ error: '无效的 PNG 派生物请求' }, { status: 400 })
  }
  try {
    const target = new URL(`/api/catalog/assets/${encodeURIComponent(params.assetId)}/${params.kind}`, catalogApiBaseUrl())
    const response = await fetch(target, { method: 'GET', redirect: 'error' })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok) {
      if (!contentType.toLowerCase().startsWith('application/json')) return Response.json({ error: 'PNG 派生物服务返回了无效响应' }, { status: 502 })
      return new Response(await response.arrayBuffer(), { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
    }
    if (contentType.toLowerCase() !== 'image/png') return Response.json({ error: '派生物不是已登记的 PNG' }, { status: 502 })
    return new Response(await response.arrayBuffer(), {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch {
    return Response.json({ error: '无法连接本机 PNG 派生物服务' }, { status: 502 })
  }
}
