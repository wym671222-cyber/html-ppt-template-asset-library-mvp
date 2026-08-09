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
  facets: { categories: string[]; tags: string[] }
  total: number
}>

export type CatalogFilters = Readonly<{
  search: string
  category: string
  tags: string[]
}>

const DERIVATIVE_URL = /^\/api\/catalog\/assets\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:preview|thumbnail)$/

export function safeDerivativeUrl(value: string): string {
  if (!DERIVATIVE_URL.test(value)) throw new Error('Catalog returned an unsafe derivative URL')
  return value
}

export function catalogQuery(filters: CatalogFilters): string {
  const parameters = new URLSearchParams()
  const search = filters.search.trim()
  if (search) parameters.set('search', search)
  if (filters.category) parameters.set('category', filters.category)
  if (filters.tags.length) parameters.set('tags', [...filters.tags].sort().join(','))
  const query = parameters.toString()
  return `/api/catalog${query ? `?${query}` : ''}`
}

export async function loadCatalog(filters: CatalogFilters, signal?: AbortSignal): Promise<CatalogResponse> {
  const response = await fetch(catalogQuery(filters), { method: 'GET', credentials: 'omit', signal })
  const body = await response.json().catch(() => ({ error: '资产目录返回了无效响应' })) as CatalogResponse | { error?: string }
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : `资产目录加载失败（${response.status}）`)
  if (!('items' in body) || !Array.isArray(body.items)) throw new Error('资产目录响应不符合共享目录契约')
  for (const item of body.items) {
    safeDerivativeUrl(item.derivative.previewUrl)
    safeDerivativeUrl(item.derivative.thumbnailUrl)
  }
  return body
}
