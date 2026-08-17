export type RecoveryBackupStorageKind = 'sealed-zip' | 'legacy-directory'

export type RecoveryValidBackup = Readonly<{
  id: string
  integrity: 'valid'
  storageKind: RecoveryBackupStorageKind
  createdAt: number
  stateSha256: string
  manifestSha256: string
  objectCount: number
  derivativeCount: number
  presentationCount: number
  exportCount: number
  manifestUrl: string
  archiveUrl: string
  restored: boolean
}>

export type RecoveryInvalidBackup = Readonly<{
  id: string
  integrity: 'invalid'
  storageKind: RecoveryBackupStorageKind | 'conflict'
  diagnostic: 'Sealed backup failed integrity verification.' | 'Legacy backup failed integrity verification.' | 'Backup storage conflict requires operator review.'
}>

export type RecoveryBackup = RecoveryValidBackup | RecoveryInvalidBackup

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

export type RecoveryActivation = Readonly<{
  id: string
  backupId: string
  stateSha256: string
  stagedAt: number
  restartRequired: true
}>

type RecoveryPayload = { error?: string; recovery?: RecoveryOverview; backup?: RecoveryValidBackup; restore?: RecoveryRestore; activation?: RecoveryActivation }

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

export async function createLocalBackup(expectedStateSha256: string): Promise<RecoveryValidBackup> {
  const payload = await request('/api/recovery/backups', 'POST', { expectedStateSha256 })
  if (!payload.backup) throw new Error('备份服务响应不符合契约')
  return payload.backup
}

export async function runIsolatedRestore(backup: RecoveryValidBackup): Promise<RecoveryRestore> {
  const payload = await request(`/api/recovery/backups/${backup.id}/restore`, 'POST', { expectedManifestSha256: backup.manifestSha256 })
  if (!payload.restore) throw new Error('恢复演练响应不符合契约')
  return payload.restore
}

export async function stageRecoveryActivation(backup: RecoveryValidBackup, confirmation: string): Promise<RecoveryActivation> {
  const payload = await request(`/api/recovery/backups/${backup.id}/activate`, 'POST', { expectedManifestSha256: backup.manifestSha256, confirmation })
  if (!payload.activation || payload.activation.restartRequired !== true) throw new Error('恢复激活响应不符合契约')
  return payload.activation
}

const MANIFEST_URL = /^\/api\/recovery\/backups\/backup-[a-z0-9-]+\/manifest$/
const ARCHIVE_URL = /^\/api\/recovery\/backups\/backup-[a-z0-9-]+\/archive$/
export function safeBackupManifestUrl(value: string): string {
  if (!MANIFEST_URL.test(value)) throw new Error('恢复服务返回了不安全的清单地址')
  return value
}

export function safeBackupArchiveUrl(value: string): string {
  if (!ARCHIVE_URL.test(value)) throw new Error('恢复服务返回了不安全的归档地址')
  return value
}
