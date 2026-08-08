import type { RequestHandler } from './$types'
import { catalogApiBaseUrl, forwardPresentationJson } from '$lib/server/catalog-api'

export const GET: RequestHandler = async ({ request }) => forward(request, '/api/presentations')
export const POST: RequestHandler = async ({ request }) => forward(request, '/api/presentations')

async function forward(request: Request, path: string): Promise<Response> {
  try { return await forwardPresentationJson(request, new URL(path, catalogApiBaseUrl())) }
  catch { return Response.json({ error: '无法连接本机汇报服务' }, { status: 502 }) }
}
