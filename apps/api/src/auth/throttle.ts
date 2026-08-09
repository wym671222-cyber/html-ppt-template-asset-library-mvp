import { createHash } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'

type Database = BetterSqlite3.Database

type ThrottleRow = {
  key_hash: string
  window_started_at: number
  count: number
  blocked_until: number | null
}

export type ThrottleDecision = Readonly<{
  allowed: boolean
  count: number
  blockedUntil: number | null
  retryAfterMs: number
}>

export type ThrottlePolicy = Readonly<{
  limit: number
  windowMs: number
  blockMs: number
}>

function assertPositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Throttle policy is invalid')
}

export function hashThrottleKey(key: unknown): string {
  if (typeof key !== 'string' || key.length < 1 || key.length > 1_024 || /[\u0000-\u001f\u007f]/.test(key)) throw new Error('Throttle key is invalid')
  return createHash('sha256').update(`auth-throttle/v1\0${key}`, 'utf8').digest('hex')
}

export class PersistentAuthThrottle {
  constructor(private readonly database: Database) {}

  consume(key: unknown, policy: ThrottlePolicy, now = Date.now()): ThrottleDecision {
    const keyHash = hashThrottleKey(key)
    assertPositiveInteger(policy.limit)
    assertPositiveInteger(policy.windowMs)
    assertPositiveInteger(policy.blockMs)
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Throttle timestamp is invalid')
    const transaction = this.database.transaction(() => {
      const row = this.database.prepare('SELECT key_hash, window_started_at, count, blocked_until FROM auth_throttle WHERE key_hash = ?').get(keyHash) as ThrottleRow | undefined
      if (!row) {
        this.database.prepare('INSERT INTO auth_throttle (key_hash, window_started_at, count, blocked_until) VALUES (?, ?, 1, NULL)').run(keyHash, now)
        return { allowed: true, count: 1, blockedUntil: null, retryAfterMs: 0 }
      }
      if (row.blocked_until !== null && row.blocked_until > now) {
        return { allowed: false, count: row.count, blockedUntil: row.blocked_until, retryAfterMs: row.blocked_until - now }
      }
      const windowEnded = now >= row.window_started_at + policy.windowMs
      const blockEnded = row.blocked_until !== null && row.blocked_until <= now
      if (windowEnded || blockEnded) {
        this.database.prepare('UPDATE auth_throttle SET window_started_at = ?, count = 1, blocked_until = NULL WHERE key_hash = ?').run(now, keyHash)
        return { allowed: true, count: 1, blockedUntil: null, retryAfterMs: 0 }
      }
      const count = row.count + 1
      if (count <= policy.limit) {
        this.database.prepare('UPDATE auth_throttle SET count = ? WHERE key_hash = ?').run(count, keyHash)
        return { allowed: true, count, blockedUntil: null, retryAfterMs: 0 }
      }
      const blockedUntil = Math.max(row.window_started_at + policy.windowMs, now + policy.blockMs)
      this.database.prepare('UPDATE auth_throttle SET count = ?, blocked_until = ? WHERE key_hash = ?').run(count, blockedUntil, keyHash)
      return { allowed: false, count, blockedUntil, retryAfterMs: blockedUntil - now }
    })
    return transaction.immediate()
  }
}
