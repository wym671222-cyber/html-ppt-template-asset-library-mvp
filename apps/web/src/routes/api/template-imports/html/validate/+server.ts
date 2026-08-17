import type { RequestHandler } from './$types'
import { forwardJson } from '$lib/server/bff'

const MAX_TEMPLATE_HTML_JSON_BYTES = 7 * 1024 * 1024

export const POST: RequestHandler = (event) => {
  if (event.url.search) return Response.json({ error: 'HTML 模板校验不接受查询参数' }, { status: 400 })
  return forwardJson(event, '/api/template-imports/html/validate', MAX_TEMPLATE_HTML_JSON_BYTES)
    .catch(() => Response.json({ error: '无法连接本机 HTML 模板校验服务' }, { status: 502 }))
}
