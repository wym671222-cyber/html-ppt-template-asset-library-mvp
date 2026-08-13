import type { RequestHandler } from './$types'
import { forwardJson } from '$lib/server/bff'

const JOB_ID = /^template-preview-[0-9a-f]{32}$/

export const GET: RequestHandler = (event) => {
  if (event.url.search || !JOB_ID.test(event.params.jobId)) return Response.json({ error: '模板预览任务编号无效' }, { status: 400 })
  return forwardJson(event, `/api/template-imports/${encodeURIComponent(event.params.jobId)}`)
    .catch(() => Response.json({ error: '无法连接本机模板导入服务' }, { status: 502 }))
}
