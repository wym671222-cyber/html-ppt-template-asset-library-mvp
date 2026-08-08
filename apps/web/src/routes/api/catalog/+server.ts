import type { RequestHandler } from './$types'
import { catalogApiBaseUrl, forwardCatalogJson } from '$lib/server/catalog-api'

export const GET: RequestHandler = async ({ url }) => {
  const target = new URL('/api/catalog', catalogApiBaseUrl())
  target.search = url.search
  try {
    return await forwardCatalogJson(target)
  } catch {
    return Response.json({ error: '无法连接本机资产目录服务' }, { status: 502 })
  }
}
