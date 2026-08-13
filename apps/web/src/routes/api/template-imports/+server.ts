import type { RequestHandler } from './$types'
import { forwardBinary } from '$lib/server/bff'

const MAX_TEMPLATE_ZIP_BYTES = 5 * 1024 * 1024

export const POST: RequestHandler = (event) => {
  if (event.url.search) return Response.json({ error: '模板导入不接受查询参数' }, { status: 400 })
  return forwardBinary(event, '/api/template-imports', 'application/zip', MAX_TEMPLATE_ZIP_BYTES)
    .catch(() => Response.json({ error: '无法连接本机模板导入服务' }, { status: 502 }))
}
