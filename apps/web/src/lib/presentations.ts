export type PresentationItem = Readonly<{ id: string; templateVersionId: string; position: number; slotOverrides: Record<string, string>; template: { title: string; versionNumber: number } }>
export type Presentation = Readonly<{ id: string; name: string; revision: number; createdAt: number; updatedAt: number; items: PresentationItem[] }>
export type PresentationExport = Readonly<{ id: string; presentationId: string; presentationRevision: number; createdAt: number; itemCount: number; manifestUrl: string; htmlUrl: string; zipUrl: string }>

type PresentationPayload = { error?: string; presentation?: Presentation; presentations?: Presentation[]; export?: PresentationExport; exports?: PresentationExport[] }

async function request(path: string, method = 'GET', body?: Record<string, unknown>): Promise<PresentationPayload> {
  const response = await fetch(path, { method, credentials: 'omit', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const payload = await response.json().catch(() => ({ error: '汇报服务返回了无效响应' })) as PresentationPayload
  if (!response.ok) throw new Error(payload.error ?? `汇报请求失败（${response.status}）`)
  return payload
}

async function presentationRequest(path: string, method = 'GET', body?: Record<string, unknown>): Promise<Presentation> {
  const payload = await request(path, method, body)
  if (!payload.presentation) throw new Error('汇报服务响应不符合契约')
  return payload.presentation
}

export const loadPresentations = async (): Promise<Presentation[]> => {
  const payload = await request('/api/presentations')
  if (!payload.presentations) throw new Error('汇报服务响应不符合契约')
  return payload.presentations
}
export const createPresentation = (name: string): Promise<Presentation> => presentationRequest('/api/presentations', 'POST', { name })
export const renamePresentation = (id: string, name: string, expectedRevision: number): Promise<Presentation> => presentationRequest(`/api/presentations/${id}`, 'PATCH', { name, expectedRevision })
export const addTemplate = (id: string, templateVersionId: string, expectedRevision: number): Promise<Presentation> => presentationRequest(`/api/presentations/${id}/items`, 'POST', { templateVersionId, expectedRevision })
export const copyItem = (id: string, itemId: string, expectedRevision: number): Promise<Presentation> => presentationRequest(`/api/presentations/${id}/items/${itemId}/copy`, 'POST', { expectedRevision })
export const deleteItem = (id: string, itemId: string, expectedRevision: number): Promise<Presentation> => presentationRequest(`/api/presentations/${id}/items/${itemId}`, 'DELETE', { expectedRevision })
export const moveItem = (id: string, itemId: string, position: number, expectedRevision: number): Promise<Presentation> => presentationRequest(`/api/presentations/${id}/items/${itemId}`, 'PATCH', { position, expectedRevision })
export const reviseOverrides = (id: string, itemId: string, slotOverrides: Record<string, string>, expectedRevision: number): Promise<Presentation> => presentationRequest(`/api/presentations/${id}/items/${itemId}`, 'PATCH', { slotOverrides, expectedRevision })

export const loadPresentationExports = async (id: string): Promise<PresentationExport[]> => {
  const payload = await request(`/api/presentations/${id}/exports`)
  if (!payload.exports) throw new Error('导出服务响应不符合契约')
  return payload.exports
}

export const createPresentationExport = async (presentation: Presentation): Promise<PresentationExport> => {
  const payload = await request(`/api/presentations/${presentation.id}/exports`, 'POST', { expectedRevision: presentation.revision, itemIds: presentation.items.map((item) => item.id) })
  if (!payload.export) throw new Error('导出服务响应不符合契约')
  return payload.export
}

const EXPORT_URL = /^\/api\/presentations\/[a-z0-9]+(?:-[a-z0-9]+)*\/exports\/export-[0-9a-f]{64}\/(?:manifest|html|zip)$/
export function safeExportUrl(value: string): string {
  if (!EXPORT_URL.test(value)) throw new Error('导出服务返回了不安全的下载地址')
  return value
}
