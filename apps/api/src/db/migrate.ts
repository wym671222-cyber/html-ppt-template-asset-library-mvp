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
  'users',
  'sessions',
  'auth_throttle',
] as const

const targetTables = new Set<string>(TARGET_DATABASE_TABLES)

export const TARGET_DATABASE_TRIGGERS = [
  'audit_events_append_only_delete',
  'audit_events_append_only_update',
  'content_objects_append_only_delete',
  'content_objects_append_only_update',
  'jobs_succeeded_output_immutable',
  'jobs_succeeded_requires_output',
  'jobs_succeeded_update_requires_output',
  'presentation_exports_append_only_delete',
  'presentation_exports_append_only_update',
  'presentation_exports_content_types_insert',
  'presentation_exports_current_revision_insert',
  'presentation_items_slot_schema_insert',
  'presentation_items_slot_schema_update',
  'presentation_items_template_version_fixed',
  'presentations_revision_monotonic',
  'template_assets_current_version_insert',
  'template_assets_current_version_update',
  'template_preview_derivatives_append_only_delete',
  'template_preview_derivatives_append_only_update',
  'template_preview_derivatives_png_insert',
  'template_preview_derivatives_verified_source_insert',
  'template_versions_current_version_status',
  'template_versions_verified_content_immutable',
  'template_versions_verified_delete_forbidden',
  'sessions_fixed_update',
  'users_disable_revokes_sessions',
  'users_password_change_revokes_sessions',
] as const

const targetTriggers = new Set<string>(TARGET_DATABASE_TRIGGERS)
const p12Triggers = new Set(['sessions_fixed_update', 'users_disable_revokes_sessions', 'users_password_change_revokes_sessions'])
const preP12TargetTriggers = TARGET_DATABASE_TRIGGERS.filter((trigger) => !p12Triggers.has(trigger))

export type DatabasePreflight = {
  existed: boolean
  tables: string[]
  triggers: string[]
  backupPath?: string
  backupSha256?: string
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function inspectSchema(path: string): { tables: string[]; triggers: string[] } {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true })
  try {
    sqlite.pragma('query_only = ON')
    sqlite.pragma('foreign_keys = ON')
    const quickCheck = sqlite.pragma('quick_check', { simple: true })
    if (quickCheck !== 'ok') throw new Error(`SQLite quick_check failed before migration: ${quickCheck}`)
    const names = (type: 'table' | 'trigger') => (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name").all(type) as { name: string }[]).map((row) => row.name)
    return { tables: names('table'), triggers: names('trigger') }
  } finally {
    sqlite.close()
  }
}

export function preflightDatabase(path = LOCAL_DATABASE_PATH): DatabasePreflight {
  if (!existsSync(path)) return { existed: false, tables: [], triggers: [] }

  const { tables, triggers } = inspectSchema(path)
  const backupDirectory = join(dirname(path), 'backups')
  mkdirSync(backupDirectory, { recursive: true })
  const backupPath = join(backupDirectory, `${basename(path, '.db')}.${Date.now()}.pre-migration.db`)
  copyFileSync(path, backupPath, 0)
  const backupSha256 = sha256(backupPath)
  const unknownTables = tables.filter((table) => !targetTables.has(table))
  if (unknownTables.length > 0) {
    throw new Error(`Migration stopped after backup: unknown database tables: ${unknownTables.join(', ')}`)
  }
  const unknownTriggers = triggers.filter((trigger) => !targetTriggers.has(trigger))
  if (unknownTriggers.length > 0) {
    throw new Error(`Migration stopped after backup: unknown database triggers: ${unknownTriggers.join(', ')}`)
  }
  const recognizedTriggerSet = JSON.stringify(triggers) === JSON.stringify([...TARGET_DATABASE_TRIGGERS].sort())
    || JSON.stringify(triggers) === JSON.stringify([...preP12TargetTriggers].sort())
  if (tables.includes('__drizzle_migrations') && !recognizedTriggerSet) {
    throw new Error('Migration stopped after backup: target database trigger set is incomplete')
  }
  return { existed: true, tables, triggers, backupPath, backupSha256 }
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
    const foreignKeyViolations = sqlite.prepare('PRAGMA foreign_key_check').all()
    if (foreignKeyViolations.length !== 0) throw new Error('SQLite foreign_key_check failed after migration')
    const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name)
    const triggers = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as { name: string }[]).map((row) => row.name)
    if (JSON.stringify(tables) !== JSON.stringify([...TARGET_DATABASE_TABLES].sort())) throw new Error('SQLite target table set is incomplete after migration')
    if (JSON.stringify(triggers) !== JSON.stringify([...TARGET_DATABASE_TRIGGERS].sort())) throw new Error('SQLite target trigger set changed unexpectedly after migration')
    return preflight
  } finally {
    sqlite.close()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = migrateDatabase()
  console.log(JSON.stringify({ database: LOCAL_DATABASE_PATH, ...result }, null, 2))
}
