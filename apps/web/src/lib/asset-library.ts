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
    mode: 'sandboxed-static' | 'sandboxed-js'
    viewport: { width: 1920; height: 1080 }
    url: string
    commands: Array<'replay' | 'reset'>
  }
  derivative: {
    rendererVersion: string
    previewUrl: string
    thumbnailUrl: string
    createdAt: number
  }
}>

type CatalogRuntime = NonNullable<CatalogItem['runtime']>

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
  if (!RUNTIME_URL.test(value)) throw new Error('Catalog returned an unsafe template runtime URL')
  return value
}

export function isCatalogRuntime(value: unknown): value is CatalogRuntime {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const runtime = value as Record<string, unknown>
  if (Object.keys(runtime).sort().join(',') !== 'commands,mode,url,viewport'
    || (runtime.mode !== 'sandboxed-static' && runtime.mode !== 'sandboxed-js')
    || typeof runtime.url !== 'string'
    || !Array.isArray(runtime.commands)
    || runtime.viewport === null
    || typeof runtime.viewport !== 'object'
    || Array.isArray(runtime.viewport)) return false
  const viewport = runtime.viewport as Record<string, unknown>
  if (Object.keys(viewport).sort().join(',') !== 'height,width'
    || viewport.width !== 1920
    || viewport.height !== 1080) return false
  return runtime.mode === 'sandboxed-static'
    ? runtime.commands.length === 0
    : runtime.commands.length === 2 && runtime.commands[0] === 'replay' && runtime.commands[1] === 'reset'
}

export function runtimeViewportScale(containerWidth: number, viewportWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) throw new Error('Runtime container width must be positive')
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) throw new Error('Runtime viewport width must be positive')
  return Math.min(1, containerWidth / viewportWidth)
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
    if (item.runtime !== null) {
      if (!isCatalogRuntime(item.runtime)) throw new Error('资产目录运行时响应不符合共享目录契约')
      safeRuntimeUrl(item.runtime.url)
    }
  }
  return body
}
