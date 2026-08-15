import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { LocalRecoveryService } from '../apps/api/src/recovery/local-recovery.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): { all(...parameters: unknown[]): unknown[] }
  exec(statement: string): void
  close(): void
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (
  path: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SQLite

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function logicalTableState(databasePath: string): string {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    database.pragma('query_only = ON')
    const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name)
    const rows = Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]))
    return JSON.stringify({ tables, rows })
  } finally {
    database.close()
  }
}

function sourceFingerprint(databasePath: string, contentRoot: string): string {
  const objects = existsSync(contentRoot)
    ? readdirSync(contentRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort()
      .map((path) => `${path.slice(contentRoot.length)}:${sha256File(path)}`)
    : []
  return createHash('sha256').update(JSON.stringify({ database: sha256File(databasePath), objects })).digest('hex')
}

describe('P00 PocketBay bare-backup physical drift baseline', () => {
  it('fails closed on a logically equivalent SQLite physical rewrite without recovery, activation, or source side effects', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'asset-library-p00-backup-drift-'))
    const databasePath = join(directory, 'source/asset-library.db')
    const contentRoot = join(directory, 'source/objects')
    const backupRoot = join(directory, 'recovery-backups')
    const restoreRoot = join(directory, 'recovery-restores')
    const activationRequestPath = join(directory, 'source/recovery-activation.json')

    try {
      migrateDatabase(databasePath)
      mkdirSync(contentRoot, { recursive: true })
      const service = new LocalRecoveryService({ databasePath, contentRoot, backupRoot, restoreRoot, activationRequestPath })
      const sourceBefore = sourceFingerprint(databasePath, contentRoot)
      const overviewBefore = service.inspectCurrent()
      const backup = await service.createBackup(overviewBefore.stateSha256)
      const backupDatabasePath = join(backupRoot, backup.id, 'database/asset-library.db')
      const backupLogicalBefore = logicalTableState(backupDatabasePath)
      const backupHashBefore = sha256File(backupDatabasePath)

      const rewritten = new Database(backupDatabasePath)
      try {
        rewritten.exec('PRAGMA journal_mode = DELETE; PRAGMA page_size = 8192; VACUUM;')
        expect(rewritten.pragma('page_size', { simple: true })).toBe(8192)
        expect(rewritten.pragma('quick_check', { simple: true })).toBe('ok')
      } finally {
        rewritten.close()
      }

      expect(logicalTableState(backupDatabasePath)).toBe(backupLogicalBefore)
      expect(sha256File(backupDatabasePath)).not.toBe(backupHashBefore)

      let originalError: Error | undefined
      try {
        service.inspectCurrent()
      } catch (error) {
        originalError = error as Error
      }

      expect(originalError?.message).toBe('Backup SQLite hash or size verification failed')
      expect(existsSync(restoreRoot)).toBe(false)
      expect(existsSync(activationRequestPath)).toBe(false)
      expect(sourceFingerprint(databasePath, contentRoot)).toBe(sourceBefore)
      if (!originalError) throw new Error('Expected LocalRecoveryService.inspectCurrent() to fail closed')
      throw originalError
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
