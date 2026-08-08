import type { RequestHandler } from './$types'
import { catalogApiBaseUrl, forwardPresentationArtifact, forwardPresentationJson } from '$lib/server/catalog-api'

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const GET: RequestHandler = async ({ request, params, url }) => {
  if (url.search || !ID.test(params.presentationId) || !ID.test(params.exportId) || !['manifest', 'html', 'zip'].includes(params.artifact)) {
    return Response.json({ error: '无效的导出物请求路径' }, { status: 400 })
  }
  try {
    const target = new URL(`/api/presentations/${encodeURIComponent(params.presentationId)}/exports/${encodeURIComponent(params.exportId)}/${params.artifact}`, catalogApiBaseUrl())
    if (params.artifact === 'manifest') return await forwardPresentationJson(request, target)
    return await forwardPresentationArtifact(target, params.artifact as 'html' | 'zip')
  } catch {
    return Response.json({ error: '无法连接本机导出服务' }, { status: 502 })
  }
}
