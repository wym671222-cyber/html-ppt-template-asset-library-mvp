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

type Payload = { error?: string; import?: TemplateImportResult; job?: TemplateImportJob }
const MAX_TEMPLATE_ZIP_BYTES = 5 * 1024 * 1024
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

export async function loadTemplateImportJob(id: string): Promise<TemplateImportJob> {
  if (!JOB_ID.test(id)) throw new Error('模板预览任务编号不安全。')
  const body = await payload(await fetch(`/api/template-imports/${encodeURIComponent(id)}`, { credentials: 'include' }))
  if (!body.job || body.job.id !== id) throw new Error('模板预览任务响应不符合契约。')
  return body.job
}
