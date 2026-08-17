import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
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

type TriggerContract = {
  triggersThroughMigration5: unknown
  migration6TriggerAdditions: unknown
  migration7TriggerAdditions: unknown
  migration8TriggerAdditions: unknown
}

function triggerNames(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name))) {
    throw new Error(`Invalid SQLite trigger contract section: ${label}`)
  }
  const sorted = [...value].sort()
  if (new Set(sorted).size !== sorted.length) throw new Error(`Duplicate SQLite trigger contract entry: ${label}`)
  return sorted
}

const triggerContract = JSON.parse(readFileSync(join(MIGRATIONS_DIRECTORY, 'schema-trigger-contract.json'), 'utf8')) as TriggerContract
const migration5Triggers = triggerNames(triggerContract.triggersThroughMigration5, 'triggersThroughMigration5')
const migration6TriggerAdditions = triggerNames(triggerContract.migration6TriggerAdditions, 'migration6TriggerAdditions')
const migration7TriggerAdditions = triggerNames(triggerContract.migration7TriggerAdditions, 'migration7TriggerAdditions')
const migration8TriggerAdditions = triggerNames(triggerContract.migration8TriggerAdditions, 'migration8TriggerAdditions')

export const TARGET_DATABASE_TRIGGER_SETS: Readonly<Record<'5' | '6' | '7' | '8', readonly string[]>> = {
  '5': migration5Triggers,
  '6': [...migration5Triggers, ...migration6TriggerAdditions].sort(),
  '7': [...migration5Triggers, ...migration6TriggerAdditions, ...migration7TriggerAdditions].sort(),
  '8': [...migration5Triggers, ...migration6TriggerAdditions, ...migration7TriggerAdditions, ...migration8TriggerAdditions].sort(),
}

export const TARGET_DATABASE_TRIGGERS = TARGET_DATABASE_TRIGGER_SETS['8']

const targetTriggers = new Set<string>(TARGET_DATABASE_TRIGGERS)

export type DatabasePreflight = {
  existed: boolean
  tables: string[]
  triggers: string[]
  pendingMigrationCount?: number
  backupPath?: string
  backupSha256?: string
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function inspectSchema(path: string): { tables: string[]; triggers: string[]; presentationOwnerColumn: boolean; ownershipCounts: Record<string, number>; appliedMigrationCount: number | null; lastMigrationCreatedAt: number | null } {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true })
  try {
    sqlite.pragma('query_only = ON')
    sqlite.pragma('foreign_keys = ON')
    const quickCheck = sqlite.pragma('quick_check', { simple: true })
    if (quickCheck !== 'ok') throw new Error(`SQLite quick_check failed before migration: ${quickCheck}`)
    const names = (type: 'table' | 'trigger') => (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name").all(type) as { name: string }[]).map((row) => row.name)
    const tables = names('table')
    const presentationOwnerColumn = tables.includes('presentations')
      && (sqlite.prepare('PRAGMA table_info(presentations)').all() as { name: string }[]).some((column) => column.name === 'owner_user_id')
    const ownershipCounts = Object.fromEntries(['presentations', 'presentation_items', 'presentation_exports'].map((table) => [
      table,
      tables.includes(table) ? (sqlite.prepare(`SELECT count(*) AS count FROM "${table}"`).get() as { count: number }).count : 0,
    ]))
    const migrationLedger = tables.includes('__drizzle_migrations')
      ? sqlite.prepare('SELECT count(*) AS count, max(created_at) AS last_created_at FROM __drizzle_migrations').get() as { count: number; last_created_at: number | null }
      : undefined
    return {
      tables,
      triggers: names('trigger'),
      presentationOwnerColumn,
      ownershipCounts,
      appliedMigrationCount: migrationLedger?.count ?? null,
      lastMigrationCreatedAt: migrationLedger?.last_created_at ?? null,
    }
  } finally {
    sqlite.close()
  }
}

export function preflightDatabase(path = LOCAL_DATABASE_PATH): DatabasePreflight {
  if (!existsSync(path)) return { existed: false, tables: [], triggers: [] }

  const { tables, triggers, presentationOwnerColumn, ownershipCounts, appliedMigrationCount, lastMigrationCreatedAt } = inspectSchema(path)
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_DIRECTORY })
  const pendingMigrationCount = migrations.filter((migration) => lastMigrationCreatedAt === null || lastMigrationCreatedAt < migration.folderMillis).length
  let backupPath: string | undefined
  let backupSha256: string | undefined
  if (pendingMigrationCount > 0) {
    const backupDirectory = join(dirname(path), 'backups')
    mkdirSync(backupDirectory, { recursive: true })
    backupPath = join(backupDirectory, `${basename(path, '.db')}.${Date.now()}.pre-migration.db`)
    copyFileSync(path, backupPath, 0)
    backupSha256 = sha256(backupPath)
  }
  const unknownTables = tables.filter((table) => !targetTables.has(table))
  if (unknownTables.length > 0) {
    throw new Error(`Migration stopped after backup: unknown database tables: ${unknownTables.join(', ')}`)
  }
  const unknownTriggers = triggers.filter((trigger) => !targetTriggers.has(trigger))
  if (unknownTriggers.length > 0) {
    throw new Error(`Migration stopped after backup: unknown database triggers: ${unknownTriggers.join(', ')}`)
  }
  if (tables.includes('__drizzle_migrations')) {
    const migrationKey = String(appliedMigrationCount)
    if (migrationKey !== '5' && migrationKey !== '6' && migrationKey !== '7' && migrationKey !== '8') {
      throw new Error('Migration stopped before execution: migration ledger is outside the supported preflight states')
    }
    const expectedTriggers = TARGET_DATABASE_TRIGGER_SETS[migrationKey]
    if (JSON.stringify(triggers) !== JSON.stringify(expectedTriggers)) {
      throw new Error('Migration stopped before execution: trigger set does not match the migration ledger')
    }
  }
  if (!presentationOwnerColumn) {
    const populated = Object.entries(ownershipCounts).filter(([, count]) => count !== 0)
    if (populated.length > 0) {
      throw new Error(`Migration stopped after backup: P14 ownership mapping required for non-empty tables: ${populated.map(([table, count]) => `${table}=${count}`).join(', ')}`)
    }
  }
  return { existed: true, tables, triggers, pendingMigrationCount, backupPath, backupSha256 }
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
