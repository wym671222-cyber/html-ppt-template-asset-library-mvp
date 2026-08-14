export type CatalogItem = Readonly<{
  id: string
  title: string
  summary: string
  category: string
  tags: string[]
  version: {
    id: string
    number: number
    status: 'verified' | 'available'
    contractVersion: string
    isCurrent: true
  }
  runtime: null | {
    mode: 'sandboxed-js'
    viewport: { width: 1920; height: 1080 }
    url: string
  }
  derivative: {
    rendererVersion: string
    previewUrl: string
    thumbnailUrl: string
    createdAt: number
  }
}>

export type CatalogResponse = Readonly<{
  items: CatalogItem[]
  facets: {
    categories: Array<{ value: string; count: number }>
    tags: Array<{ value: string; count: number }>
    statuses: Array<{ value: 'verified' | 'available'; count: number }>
  }
  total: number
  limit: number
  offset: number
}>

export type CatalogFilters = Readonly<{
  search: string
  category: string
  tags: string[]
  status?: '' | 'verified' | 'available'
  sort?: 'updated-desc' | 'title-asc'
  limit?: number
  offset?: number
}>

const DERIVATIVE_URL = /^\/api\/catalog\/assets\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:preview|thumbnail)$/
const RUNTIME_URL = /^\/api\/catalog\/assets\/[a-z0-9]+(?:-[a-z0-9]+)*\/runtime$/

export function safeDerivativeUrl(value: string): string {
  if (!DERIVATIVE_URL.test(value)) throw new Error('Catalog returned an unsafe derivative URL')
  return value
}

export function safeRuntimeUrl(value: string): string {
  if (!RUNTIME_URL.test(value)) throw new Error('Catalog returned an unsafe interactive runtime URL')
  return value
}

export function catalogQuery(filters: CatalogFilters): string {
  const parameters = new URLSearchParams()
  const search = filters.search.trim()
  if (search) parameters.set('search', search)
  if (filters.category) parameters.set('category', filters.category)
  if (filters.tags.length) parameters.set('tags', [...filters.tags].sort().join(','))
  if (filters.status) parameters.set('status', filters.status)
  if (filters.sort && filters.sort !== 'updated-desc') parameters.set('sort', filters.sort)
  if (filters.limit !== undefined && filters.limit !== 24) parameters.set('limit', String(filters.limit))
  if (filters.offset !== undefined && filters.offset > 0) parameters.set('offset', String(filters.offset))
  const query = parameters.toString()
  return `/api/catalog${query ? `?${query}` : ''}`
}

export async function loadCatalog(filters: CatalogFilters, signal?: AbortSignal): Promise<CatalogResponse> {
  const response = await fetch(catalogQuery(filters), { method: 'GET', credentials: 'include', signal })
  const body = await response.json().catch(() => ({ error: '资产目录返回了无效响应' })) as CatalogResponse | { error?: string }
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : `资产目录加载失败（${response.status}）`)
  if (!('items' in body) || !Array.isArray(body.items)) throw new Error('资产目录响应不符合共享目录契约')
  for (const item of body.items) {
    safeDerivativeUrl(item.derivative.previewUrl)
    safeDerivativeUrl(item.derivative.thumbnailUrl)
    if (item.runtime !== null) safeRuntimeUrl(item.runtime.url)
  }
  return body
}
