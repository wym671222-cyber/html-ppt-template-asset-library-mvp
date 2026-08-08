export type PresentationItem = Readonly<{ id: string; templateVersionId: string; position: number; slotOverrides: Record<string, string>; template: { title: string; versionNumber: number } }>
export type Presentation = Readonly<{ id: string; name: string; revision: number; createdAt: number; updatedAt: number; items: PresentationItem[] }>

async function request(path: string, method = 'GET', body?: Record<string, unknown>): Promise<Presentation | Presentation[]> {
  const response = await fetch(path, { method, credentials: 'omit', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const payload = await response.json().catch(() => ({ error: '汇报服务返回了无效响应' })) as { error?: string; presentation?: Presentation; presentations?: Presentation[] }
  if (!response.ok) throw new Error(payload.error ?? `汇报请求失败（${response.status}）`)
  if (payload.presentation) return payload.presentation
  if (payload.presentations) return payload.presentations
  throw new Error('汇报服务响应不符合契约')
}

export const loadPresentations = (): Promise<Presentation[]> => request('/api/presentations') as Promise<Presentation[]>
export const createPresentation = (name: string): Promise<Presentation> => request('/api/presentations', 'POST', { name }) as Promise<Presentation>
export const renamePresentation = (id: string, name: string, expectedRevision: number): Promise<Presentation> => request(`/api/presentations/${id}`, 'PATCH', { name, expectedRevision }) as Promise<Presentation>
export const addTemplate = (id: string, templateVersionId: string, expectedRevision: number): Promise<Presentation> => request(`/api/presentations/${id}/items`, 'POST', { templateVersionId, expectedRevision }) as Promise<Presentation>
export const copyItem = (id: string, itemId: string, expectedRevision: number): Promise<Presentation> => request(`/api/presentations/${id}/items/${itemId}/copy`, 'POST', { expectedRevision }) as Promise<Presentation>
export const deleteItem = (id: string, itemId: string, expectedRevision: number): Promise<Presentation> => request(`/api/presentations/${id}/items/${itemId}`, 'DELETE', { expectedRevision }) as Promise<Presentation>
export const moveItem = (id: string, itemId: string, position: number, expectedRevision: number): Promise<Presentation> => request(`/api/presentations/${id}/items/${itemId}`, 'PATCH', { position, expectedRevision }) as Promise<Presentation>
export const reviseOverrides = (id: string, itemId: string, slotOverrides: Record<string, string>, expectedRevision: number): Promise<Presentation> => request(`/api/presentations/${id}/items/${itemId}`, 'PATCH', { slotOverrides, expectedRevision }) as Promise<Presentation>
