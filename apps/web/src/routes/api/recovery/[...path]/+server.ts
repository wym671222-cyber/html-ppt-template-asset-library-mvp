import type { RequestHandler } from './$types'
import { forwardArtifact, forwardBinary, forwardJson } from '$lib/server/bff'

const BACKUP_ID = /^backup-[a-z0-9-]+$/
const MAX_RECOVERY_ARCHIVE_BYTES = 128 * 1024 * 1024

function controlledPath(path: string, method: string): string | null {
  const segments = path.split('/')
  if (segments.length === 1 && segments[0] === 'backups' && method === 'POST') return '/api/recovery/backups'
  if (segments.length === 2 && segments[0] === 'backups' && segments[1] === 'import' && method === 'POST') return '/api/recovery/backups/import'
  if (segments.length !== 3 || segments[0] !== 'backups' || !BACKUP_ID.test(segments[1])) return null
  if (segments[2] === 'manifest' && method === 'GET') return `/api/recovery/backups/${encodeURIComponent(segments[1])}/manifest`
  if (segments[2] === 'archive' && method === 'GET') return `/api/recovery/backups/${encodeURIComponent(segments[1])}/archive`
  if (segments[2] === 'restore' && method === 'POST') return `/api/recovery/backups/${encodeURIComponent(segments[1])}/restore`
  if (segments[2] === 'activate' && method === 'POST') return `/api/recovery/backups/${encodeURIComponent(segments[1])}/activate`
  return null
}

async function forward(event: Parameters<RequestHandler>[0], path: string, url: URL): Promise<Response> {
  if (url.search) return Response.json({ error: '恢复请求不接受查询参数' }, { status: 400 })
  const targetPath = controlledPath(path, event.request.method)
  if (!targetPath) return Response.json({ error: '无效的恢复请求路径' }, { status: 400 })
  try {
    if (path.endsWith('/archive')) return await forwardArtifact(event, targetPath, 'zip')
    if (path === 'backups/import') return await forwardBinary(event, targetPath, 'application/zip', MAX_RECOVERY_ARCHIVE_BYTES)
    return await forwardJson(event, targetPath)
  }
  catch { return Response.json({ error: '无法连接本机恢复服务' }, { status: 502 }) }
}

export const GET: RequestHandler = async (event) => forward(event, event.params.path, event.url)
export const POST: RequestHandler = async (event) => forward(event, event.params.path, event.url)
