import type { RequestHandler } from './$types'
import { forwardArtifact, forwardJson } from '$lib/server/bff'

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const GET: RequestHandler = async (event) => {
  const { params, url } = event
  if (url.search || !ID.test(params.presentationId) || !ID.test(params.exportId) || !['manifest', 'html', 'zip'].includes(params.artifact)) {
    return Response.json({ error: '无效的导出物请求路径' }, { status: 400 })
  }
  try {
    const path = `/api/presentations/${encodeURIComponent(params.presentationId)}/exports/${encodeURIComponent(params.exportId)}/${params.artifact}`
    if (params.artifact === 'manifest') return await forwardJson(event, path)
    return await forwardArtifact(event, path, params.artifact as 'html' | 'zip')
  } catch {
    return Response.json({ error: '无法连接本机导出服务' }, { status: 502 })
  }
}
