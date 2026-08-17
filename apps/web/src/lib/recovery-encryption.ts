import { safeBackupArchiveUrl, type RecoveryValidBackup } from './recovery'

const MAGIC = new TextEncoder().encode('PBACKUP1')
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const PBKDF2_ITERATIONS = 600_000
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_ENCRYPTED_BYTES = MAX_ARCHIVE_BYTES + MAGIC.byteLength + SALT_BYTES + IV_BYTES + TAG_BYTES

function toArrayBuffer(content: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(content.byteLength)
  copy.set(content)
  return copy.buffer
}

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < 14 || passphrase.length > 200) throw new Error('备份口令须为 14–200 个字符。')
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const source = await crypto.subtle.importKey('raw', toArrayBuffer(new TextEncoder().encode(passphrase)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations: PBKDF2_ITERATIONS },
    source,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptRecoveryArchive(content: Uint8Array, passphrase: string): Promise<Uint8Array> {
  assertPassphrase(passphrase)
  if (content.byteLength < 22 || content.byteLength > MAX_ARCHIVE_BYTES) throw new Error('恢复归档大小不符合限制。')
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt)
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(MAGIC) }, key, toArrayBuffer(content)))
  const result = new Uint8Array(MAGIC.byteLength + salt.byteLength + iv.byteLength + encrypted.byteLength)
  result.set(MAGIC, 0)
  result.set(salt, MAGIC.byteLength)
  result.set(iv, MAGIC.byteLength + SALT_BYTES)
  result.set(encrypted, MAGIC.byteLength + SALT_BYTES + IV_BYTES)
  return result
}

export async function decryptRecoveryArchive(content: Uint8Array, passphrase: string): Promise<Uint8Array> {
  assertPassphrase(passphrase)
  if (content.byteLength < MAGIC.byteLength + SALT_BYTES + IV_BYTES + TAG_BYTES + 22 || content.byteLength > MAX_ENCRYPTED_BYTES) throw new Error('加密备份文件大小不符合限制。')
  const magic = content.subarray(0, MAGIC.byteLength)
  if (!equalBytes(magic, MAGIC)) throw new Error('这不是受支持的 PocketBay 加密备份。')
  const salt = content.subarray(MAGIC.byteLength, MAGIC.byteLength + SALT_BYTES)
  const iv = content.subarray(MAGIC.byteLength + SALT_BYTES, MAGIC.byteLength + SALT_BYTES + IV_BYTES)
  const encrypted = content.subarray(MAGIC.byteLength + SALT_BYTES + IV_BYTES)
  try {
    const key = await deriveKey(passphrase, salt)
    const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(MAGIC) }, key, toArrayBuffer(encrypted)))
    if (decrypted.byteLength < 22 || decrypted.byteLength > MAX_ARCHIVE_BYTES || new DataView(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength).getUint32(0, true) !== 0x04034b50) throw new Error('ZIP signature is invalid')
    return decrypted
  } catch {
    throw new Error('备份口令错误，或加密文件已损坏。')
  }
}

export async function downloadEncryptedRecoveryBackup(backup: RecoveryValidBackup, passphrase: string): Promise<void> {
  const response = await fetch(safeBackupArchiveUrl(backup.archiveUrl), { credentials: 'include' })
  if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/zip')) throw new Error(`恢复归档下载失败（${response.status}）。`)
  const archive = new Uint8Array(await response.arrayBuffer())
  const encrypted = await encryptRecoveryArchive(archive, passphrase)
  const url = URL.createObjectURL(new Blob([toArrayBuffer(encrypted)], { type: 'application/x-pocketbay-backup' }))
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${backup.id}.pba`
    anchor.rel = 'noopener'
    anchor.click()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export async function importEncryptedRecoveryBackup(file: File, passphrase: string): Promise<RecoveryValidBackup> {
  if (!file.name.toLowerCase().endsWith('.pba')) throw new Error('请选择 .pba 加密备份文件。')
  if (file.size < 1 || file.size > MAX_ENCRYPTED_BYTES) throw new Error('加密备份文件大小不符合限制。')
  const archive = await decryptRecoveryArchive(new Uint8Array(await file.arrayBuffer()), passphrase)
  const response = await fetch('/api/recovery/backups/import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/zip' },
    body: new Blob([toArrayBuffer(archive)], { type: 'application/zip' }),
  })
  const payload = await response.json().catch(() => ({ error: '恢复服务返回了无效响应' })) as { error?: string; backup?: RecoveryValidBackup }
  if (!response.ok) throw new Error(payload.error ?? `加密备份导入失败（${response.status}）。`)
  if (!payload.backup) throw new Error('恢复服务响应不符合备份契约。')
  return payload.backup
}
