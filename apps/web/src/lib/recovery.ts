export type RecoveryBackup = Readonly<{
  id: string
  createdAt: number
  stateSha256: string
  manifestSha256: string
  objectCount: number
  derivativeCount: number
  presentationCount: number
  exportCount: number
  manifestUrl: string
  restored: boolean
}>

export type RecoveryOverview = Readonly<{
  stateSha256: string
  databaseSha256: string
  migrationCount: number
  objectCount: number
  derivativeCount: number
  presentationCount: number
  exportCount: number
  backups: RecoveryBackup[]
}>

export type RecoveryRestore = Readonly<{
  id: string
  backupId: string
  verifiedAt: number
  databaseSha256: string
  stateSha256: string
  objectCount: number
  derivativeCount: number
  presentationCount: number
  exportCount: number
}>

type RecoveryPayload = { error?: string; recovery?: RecoveryOverview; backup?: RecoveryBackup; restore?: RecoveryRestore }

async function request(path: string, method = 'GET', body?: Record<string, unknown>): Promise<RecoveryPayload> {
  const response = await fetch(path, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const payload = await response.json().catch(() => ({ error: '恢复服务返回了无效响应' })) as RecoveryPayload
  if (!response.ok) throw new Error(payload.error ?? `恢复请求失败（${response.status}）`)
  return payload
}

export async function loadRecoveryOverview(): Promise<RecoveryOverview> {
  const payload = await request('/api/recovery')
  if (!payload.recovery || !Array.isArray(payload.recovery.backups)) throw new Error('恢复服务响应不符合全局管理契约')
  return payload.recovery
}

export async function createLocalBackup(expectedStateSha256: string): Promise<RecoveryBackup> {
  const payload = await request('/api/recovery/backups', 'POST', { expectedStateSha256 })
  if (!payload.backup) throw new Error('备份服务响应不符合契约')
  return payload.backup
}

export async function runIsolatedRestore(backup: RecoveryBackup): Promise<RecoveryRestore> {
  const payload = await request(`/api/recovery/backups/${backup.id}/restore`, 'POST', { expectedManifestSha256: backup.manifestSha256 })
  if (!payload.restore) throw new Error('恢复演练响应不符合契约')
  return payload.restore
}

const MANIFEST_URL = /^\/api\/recovery\/backups\/backup-[a-z0-9-]+\/manifest$/
export function safeBackupManifestUrl(value: string): string {
  if (!MANIFEST_URL.test(value)) throw new Error('恢复服务返回了不安全的清单地址')
  return value
}
