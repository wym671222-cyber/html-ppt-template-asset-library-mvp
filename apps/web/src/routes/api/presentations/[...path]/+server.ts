import type { RequestHandler } from './$types'
import { catalogApiBaseUrl, forwardPresentationJson } from '$lib/server/catalog-api'

const SEGMENT = /^[a-z0-9-]+$/

export const GET: RequestHandler = async ({ request, params }) => forward(request, params.path)
export const POST: RequestHandler = async ({ request, params }) => forward(request, params.path)
export const PATCH: RequestHandler = async ({ request, params }) => forward(request, params.path)
export const DELETE: RequestHandler = async ({ request, params }) => forward(request, params.path)

async function forward(request: Request, path: string): Promise<Response> {
  const segments = path.split('/')
  if (!segments.length || segments.length > 5 || segments.some((segment) => !SEGMENT.test(segment))) return Response.json({ error: '无效的汇报请求路径' }, { status: 400 })
  try { return await forwardPresentationJson(request, new URL(`/api/presentations/${segments.map(encodeURIComponent).join('/')}`, catalogApiBaseUrl())) }
  catch { return Response.json({ error: '无法连接本机汇报服务' }, { status: 502 }) }
}
