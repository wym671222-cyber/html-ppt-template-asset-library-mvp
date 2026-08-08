import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { LOCAL_DATABASE_PATH, MIGRATIONS_DIRECTORY } from './paths.js'

export const TARGET_DATABASE_TABLES = [
  '__drizzle_migrations',
  'content_objects',
  'template_assets',
  'template_versions',
  'tags',
  'template_asset_tags',
  'presentations',
  'presentation_items',
  'presentation_exports',
  'jobs',
  'template_preview_derivatives',
  'audit_events',
] as const

const targetTables = new Set<string>(TARGET_DATABASE_TABLES)

export type DatabasePreflight = {
  existed: boolean
  tables: string[]
  backupPath?: string
  backupSha256?: string
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function inspectTables(path: string): string[] {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true })
  try {
    sqlite.pragma('query_only = ON')
    sqlite.pragma('foreign_keys = ON')
    const quickCheck = sqlite.pragma('quick_check', { simple: true })
    if (quickCheck !== 'ok') throw new Error(`SQLite quick_check failed before migration: ${quickCheck}`)
    return (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name)
  } finally {
    sqlite.close()
  }
}

export function preflightDatabase(path = LOCAL_DATABASE_PATH): DatabasePreflight {
  if (!existsSync(path)) return { existed: false, tables: [] }

  const tables = inspectTables(path)
  const backupDirectory = join(dirname(path), 'backups')
  mkdirSync(backupDirectory, { recursive: true })
  const backupPath = join(backupDirectory, `${basename(path, '.db')}.${Date.now()}.pre-migration.db`)
  copyFileSync(path, backupPath, 0)
  const backupSha256 = sha256(backupPath)
  const unknownTables = tables.filter((table) => !targetTables.has(table))
  if (unknownTables.length > 0) {
    throw new Error(`Migration stopped after backup: unknown database tables: ${unknownTables.join(', ')}`)
  }
  return { existed: true, tables, backupPath, backupSha256 }
}

export function migrateDatabase(path = LOCAL_DATABASE_PATH): DatabasePreflight {
  const preflight = preflightDatabase(path)
  mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIRECTORY })
    const quickCheck = sqlite.pragma('quick_check', { simple: true })
    if (quickCheck !== 'ok') throw new Error(`SQLite quick_check failed after migration: ${quickCheck}`)
    if (sqlite.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('SQLite foreign_keys is not enabled')
    return preflight
  } finally {
    sqlite.close()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = migrateDatabase()
  console.log(JSON.stringify({ database: LOCAL_DATABASE_PATH, ...result }, null, 2))
}
