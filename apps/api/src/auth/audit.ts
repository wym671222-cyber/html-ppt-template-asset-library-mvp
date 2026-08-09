import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'

type Database = BetterSqlite3.Database

const AUDIT_VALUE = /^[a-z0-9._:-]{1,96}$/
const DIAGNOSTIC_CODE = /^[A-Z][A-Z0-9_]{0,63}$/

export type AuditResult = 'success' | 'failure'

export class AuditEventWriter {
  constructor(private readonly database: Database) {}

  record(input: {
    action: string
    entityType: string
    entityId: string
    result: AuditResult
    diagnostic: string
    now?: number
  }): void {
    if (!AUDIT_VALUE.test(input.action) || !AUDIT_VALUE.test(input.entityType) || !AUDIT_VALUE.test(input.entityId)) {
      throw new Error('Audit event identity is invalid')
    }
    if (!DIAGNOSTIC_CODE.test(input.diagnostic)) throw new Error('Audit diagnostic code is invalid')
    const now = input.now ?? Date.now()
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Audit timestamp is invalid')
    this.database.prepare(`
      INSERT INTO audit_events (id, action, entity_type, entity_id, result, diagnostic, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(`audit-${randomUUID()}`, input.action, input.entityType, input.entityId, input.result, input.diagnostic, now)
  }
}
