export type TemplateImportJob = Readonly<{
  id: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  attempt: number
  maxAttempts: number
  diagnostic: string
  available: boolean
}>

export type TemplateImportResult = Readonly<{
  assetId: string
  versionId: string
  created: boolean
  job: TemplateImportJob
}>

export type HtmlTemplateMetadata = Readonly<{
  title: string
  summary: string
  category: string
  tags: string[]
}>

export type HtmlTemplateValidation = Readonly<{
  assetId: string
  versionId: string
  title: string
  category: string
  tags: string[]
  sourceBytes: number
  normalizedFiles: string[]
}>

type Payload = { error?: string; import?: TemplateImportResult; job?: TemplateImportJob; validation?: HtmlTemplateValidation }
const MAX_TEMPLATE_ZIP_BYTES = 5 * 1024 * 1024
const MAX_TEMPLATE_HTML_BYTES = 5 * 1024 * 1024
const JOB_ID = /^template-preview-[0-9a-f]{32}$/

async function payload(response: Response): Promise<Payload> {
  const body = await response.json().catch(() => ({ error: '模板导入服务返回了无效响应' })) as Payload
  if (!response.ok) throw new Error(body.error ?? `模板导入请求失败（${response.status}）`)
  return body
}

export async function uploadTemplateZip(file: File): Promise<TemplateImportResult> {
  if (!file.name.toLowerCase().endsWith('.zip')) throw new Error('请选择 .zip 模板包。')
  if (file.size < 22 || file.size > MAX_TEMPLATE_ZIP_BYTES) throw new Error('模板 ZIP 必须小于 5 MiB。')
  const response = await fetch('/api/template-imports', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/zip' },
    body: file,
  })
  const body = await payload(response)
  if (!body.import || !JOB_ID.test(body.import.job.id)) throw new Error('模板导入响应不符合契约。')
  return body.import
}

async function htmlRequest(file: File, metadata: HtmlTemplateMetadata): Promise<Record<string, unknown>> {
  if (!/\.html?$/i.test(file.name)) throw new Error('请选择 .html 或 .htm 文件。')
  if (file.type && file.type.toLowerCase() !== 'text/html') throw new Error('HTML 文件媒体类型必须为 text/html。')
  if (file.size === 0 || file.size > MAX_TEMPLATE_HTML_BYTES) throw new Error('HTML 文件必须小于 5 MiB。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return {
    filename: file.name,
    mimeType: 'text/html',
    contentBase64: btoa(binary),
    title: metadata.title,
    summary: metadata.summary,
    category: metadata.category,
    tags: metadata.tags,
  }
}

export async function validateTemplateHtml(file: File, metadata: HtmlTemplateMetadata): Promise<HtmlTemplateValidation> {
  const response = await fetch('/api/template-imports/html/validate', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await htmlRequest(file, metadata)),
  })
  const body = await payload(response)
  if (!body.validation) throw new Error('HTML 模板校验响应不符合契约。')
  return body.validation
}

export async function uploadTemplateHtml(file: File, metadata: HtmlTemplateMetadata): Promise<TemplateImportResult> {
  const response = await fetch('/api/template-imports/html', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await htmlRequest(file, metadata)),
  })
  const body = await payload(response)
  if (!body.import || !JOB_ID.test(body.import.job.id)) throw new Error('HTML 模板导入响应不符合契约。')
  return body.import
}

export async function loadTemplateImportJob(id: string): Promise<TemplateImportJob> {
  if (!JOB_ID.test(id)) throw new Error('模板预览任务编号不安全。')
  const body = await payload(await fetch(`/api/template-imports/${encodeURIComponent(id)}`, { credentials: 'include' }))
  if (!body.job || body.job.id !== id) throw new Error('模板预览任务响应不符合契约。')
  return body.job
}
