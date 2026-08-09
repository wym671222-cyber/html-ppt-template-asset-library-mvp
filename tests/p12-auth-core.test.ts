import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import {
  parseSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  SESSION_COOKIE_NAME,
} from '../apps/api/src/auth/cookie.js'
import {
  ARGON2ID_POLICY,
  hashPassword,
  passwordHashMeetsPolicy,
  verifyPassword,
} from '../apps/api/src/auth/password.js'
import { hashSessionToken, SESSION_DURATION_MS, SessionRepository } from '../apps/api/src/auth/sessions.js'
import { hashThrottleKey, PersistentAuthThrottle } from '../apps/api/src/auth/throttle.js'
import { normalizeUsername, UserRepository } from '../apps/api/src/auth/users.js'
import { migrateDatabase, TARGET_DATABASE_TABLES, TARGET_DATABASE_TRIGGERS } from '../apps/api/src/db/migrate.js'
import { MIGRATIONS_DIRECTORY } from '../apps/api/src/db/paths.js'
import { LocalRecoveryService } from '../apps/api/src/recovery/local-recovery.js'

type RunResult = { changes: number }
type Statement = {
  all(...parameters: unknown[]): unknown[]
  get(...parameters: unknown[]): unknown
  run(...parameters: unknown[]): RunResult
}
type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): Statement
  exec(statement: string): void
  close(): void
}

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url))
const Database = apiRequire('better-sqlite3') as new (path: string, options?: { readonly?: boolean; fileMustExist?: boolean }) => SQLite
const drizzle = (apiRequire('drizzle-orm/better-sqlite3') as { drizzle(database: SQLite): unknown }).drizzle
const drizzleMigrate = (apiRequire('drizzle-orm/better-sqlite3/migrator') as { migrate(database: unknown, options: { migrationsFolder: string }): void }).migrate

const temporaryRoots: string[] = []

function temporaryRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `asset-library-${label}-`))
  temporaryRoots.push(root)
  return root
}

function databasePath(label: string): string {
  return join(temporaryRoot(label), 'asset-library.db')
}

function openDatabase(path: string): SQLite {
  const database = new Database(path)
  database.pragma('foreign_keys = ON')
  return database
}

function scalar(database: SQLite, sql: string): number {
  return (database.prepare(sql).get() as { count: number }).count
}

function schemaNames(database: SQLite, type: 'table' | 'trigger'): string[] {
  return (database.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name").all(type) as { name: string }[]).map((row) => row.name)
}

function triggerDefinitions(database: SQLite): Array<{ name: string; sql: string }> {
  return database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as Array<{ name: string; sql: string }>
}

function businessCounts(database: SQLite): Record<string, number> {
  const tables = [
    'content_objects', 'template_assets', 'template_versions', 'tags', 'template_asset_tags', 'presentations',
    'presentation_items', 'presentation_exports', 'jobs', 'template_preview_derivatives', 'audit_events',
  ]
  return Object.fromEntries(tables.map((table) => [table, scalar(database, `SELECT count(*) AS count FROM ${table}`)]))
}

function createFiveMigrationDatabase(path: string): void {
  const migrations = join(temporaryRoot('p12-five-migrations'), 'drizzle')
  mkdirSync(join(migrations, 'meta'), { recursive: true })
  for (let index = 0; index < 5; index += 1) {
    const prefix = String(index).padStart(4, '0')
    const source = readdirSync(MIGRATIONS_DIRECTORY).find((name) => name.startsWith(`${prefix}_`) && name.endsWith('.sql'))
    if (!source) throw new Error(`Missing migration fixture ${prefix}`)
    cpSync(join(MIGRATIONS_DIRECTORY, source), join(migrations, source))
  }
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIRECTORY, 'meta/_journal.json'), 'utf8')) as { entries: unknown[] }
  writeFileSync(join(migrations, 'meta/_journal.json'), `${JSON.stringify({ ...journal, entries: journal.entries.slice(0, 5) }, null, 2)}\n`)
  mkdirSync(dirname(path), { recursive: true })
  const database = openDatabase(path)
  try { drizzleMigrate(drizzle(database), { migrationsFolder: migrations }) } finally { database.close() }
}

function databaseSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('P12 numbered migration and recovery boundaries', () => {
  it('migrates an empty database with the exact tables, old triggers, ledger, integrity and constraints', () => {
    const path = databasePath('p12-empty')
    expect(migrateDatabase(path)).toEqual({ existed: false, tables: [], triggers: [] })
    const database = openDatabase(path)
    try {
      expect(database.pragma('quick_check', { simple: true })).toBe('ok')
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(schemaNames(database, 'table')).toEqual([...TARGET_DATABASE_TABLES].sort())
      expect(schemaNames(database, 'trigger')).toEqual([...TARGET_DATABASE_TRIGGERS].sort())
      expect(scalar(database, 'SELECT count(*) AS count FROM __drizzle_migrations')).toBe(6)
      expect(scalar(database, 'SELECT count(*) AS count FROM users')).toBe(0)
      expect(scalar(database, 'SELECT count(*) AS count FROM sessions')).toBe(0)
      expect(scalar(database, 'SELECT count(*) AS count FROM auth_throttle')).toBe(0)
      const userColumns = (database.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((column) => column.name)
      expect(userColumns).toEqual([
        'id', 'username', 'password_hash', 'role', 'status', 'must_change_password', 'approved_by', 'approved_at',
        'password_changed_at', 'created_at', 'updated_at',
      ])
      expect(userColumns.join(',')).not.toMatch(/email/i)
    } finally { database.close() }
  })

  it('upgrades an existing five-migration database, preserves records and is repeatable', () => {
    const path = databasePath('p12-existing-five')
    createFiveMigrationDatabase(path)
    const before = openDatabase(path)
    const oldTriggers = schemaNames(before, 'trigger')
    const oldTriggerDefinitions = triggerDefinitions(before)
    before.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'a'.repeat(64), 'text/plain', 1, `sha256/aa/${'a'.repeat(64)}`, 1,
    )
    const countsBefore = businessCounts(before)
    before.close()

    const migrated = migrateDatabase(path)
    expect(migrated).toMatchObject({ existed: true, triggers: oldTriggers })
    expect(migrated.backupPath && existsSync(migrated.backupPath)).toBe(true)
    expect(migrated.backupSha256).toMatch(/^[0-9a-f]{64}$/)
    const database = openDatabase(path)
    try {
      expect(schemaNames(database, 'trigger')).toEqual([...TARGET_DATABASE_TRIGGERS].sort())
      const migratedDefinitions = new Map(triggerDefinitions(database).map((trigger) => [trigger.name, trigger.sql]))
      expect(oldTriggerDefinitions.every((trigger) => migratedDefinitions.get(trigger.name) === trigger.sql)).toBe(true)
      expect(scalar(database, 'SELECT count(*) AS count FROM __drizzle_migrations')).toBe(6)
      expect(businessCounts(database)).toEqual(countsBefore)
      expect(database.pragma('quick_check', { simple: true })).toBe('ok')
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { database.close() }

    const beforeRepeat = databaseSha256(path)
    expect(migrateDatabase(path)).toMatchObject({ existed: true })
    expect(databaseSha256(path)).toBe(beforeRepeat)
    const repeated = openDatabase(path)
    try {
      expect(scalar(repeated, 'SELECT count(*) AS count FROM __drizzle_migrations')).toBe(6)
      expect(businessCounts(repeated)).toEqual(countsBefore)
    } finally { repeated.close() }
  })

  it('backs up and rejects unknown tables plus unknown or missing legacy triggers', () => {
    const unknownTablePath = databasePath('p12-unknown-table')
    const unknownTable = openDatabase(unknownTablePath)
    unknownTable.exec('CREATE TABLE unexpected_payload (id text PRIMARY KEY)')
    unknownTable.close()
    expect(() => migrateDatabase(unknownTablePath)).toThrow(/unknown database tables: unexpected_payload/)
    expect(readdirSync(join(dirname(unknownTablePath), 'backups'))).toHaveLength(1)

    for (const fault of ['unknown', 'missing'] as const) {
      const path = databasePath(`p12-${fault}-trigger`)
      createFiveMigrationDatabase(path)
      const database = openDatabase(path)
      if (fault === 'unknown') database.exec('CREATE TRIGGER unexpected_trigger BEFORE INSERT ON content_objects BEGIN SELECT RAISE(ABORT, \'blocked\'); END')
      else database.exec('DROP TRIGGER audit_events_append_only_delete')
      database.close()
      expect(() => migrateDatabase(path)).toThrow(fault === 'unknown' ? /unknown database triggers: unexpected_trigger/ : /trigger set is incomplete/)
      expect(readdirSync(join(dirname(path), 'backups'))).toHaveLength(1)
    }
  })

  it('includes the sixth ledger and auth tables in isolated backup/restore without secret diagnostics', async () => {
    const root = temporaryRoot('p12-recovery')
    const path = join(root, 'source/asset-library.db')
    migrateDatabase(path)
    const database = openDatabase(path)
    const rawPassword = 'r'.repeat(10)
    const passwordHash = await hashPassword(rawPassword)
    const user = new UserRepository(database as never).create({ username: 'recovery_user', passwordHash, status: 'active', now: 10 })
    const created = new SessionRepository(database as never).create(user.id, 20)
    new PersistentAuthThrottle(database as never).consume('login:recovery_user', { limit: 1, windowMs: 60_000, blockMs: 60_000 }, 30)
    database.close()

    const service = new LocalRecoveryService({
      databasePath: path,
      contentRoot: join(root, 'source/objects'),
      backupRoot: join(root, 'backups'),
      restoreRoot: join(root, 'restores'),
    })
    const overview = service.inspectCurrent()
    expect(overview.migrationCount).toBe(6)
    const backup = await service.createBackup(overview.stateSha256)
    const { manifest } = service.readBackupManifest(backup.id)
    expect(manifest.database.migrationLedger.at(-1)?.tag).toBe('0005_p12_auth_core')
    const serializedManifest = JSON.stringify(manifest)
    expect(serializedManifest).not.toContain(rawPassword)
    expect(serializedManifest).not.toContain(created.token)
    expect(serializedManifest).not.toContain(created.cookie)
    const restore = service.restoreBackup(backup.id, backup.manifestSha256)
    const restored = openDatabase(join(root, 'restores', restore.id, 'database/asset-library.db'))
    try {
      expect(scalar(restored, 'SELECT count(*) AS count FROM users')).toBe(1)
      expect(scalar(restored, 'SELECT count(*) AS count FROM sessions')).toBe(1)
      expect(scalar(restored, 'SELECT count(*) AS count FROM auth_throttle')).toBe(1)
      expect(restored.pragma('quick_check', { simple: true })).toBe('ok')
      expect(restored.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { restored.close() }
  })
})

describe('P12 username, password and single-admin constraints', () => {
  it('normalizes usernames and rejects duplicates, malformed values and a second administrator', async () => {
    const path = databasePath('p12-users')
    migrateDatabase(path)
    const database = openDatabase(path)
    try {
      const passwordHash = await hashPassword('a'.repeat(10))
      const users = new UserRepository(database as never)
      expect(normalizeUsername('  Alice_01  ')).toBe('alice_01')
      expect(users.create({ username: '  Alice_01  ', passwordHash, status: 'active', now: 1 })).toMatchObject({ username: 'alice_01', role: 'member', status: 'active' })
      expect(() => users.create({ username: 'ALICE_01', passwordHash, now: 2 })).toThrow(/constraint/)
      for (const invalid of ['ab', '1alice', 'ali ce', 'a'.repeat(33), 'álîce']) expect(() => normalizeUsername(invalid)).toThrow(/invalid/)
      expect(() => database.prepare(`INSERT INTO users (id, username, password_hash, role, status, password_changed_at, created_at, updated_at) VALUES (?, 'UpperCase', ?, 'member', 'pending', 1, 1, 1)`).run('user-direct-upper', passwordHash)).toThrow()
      users.create({ username: 'admin_one', passwordHash, role: 'admin', status: 'active', now: 3 })
      expect(() => users.create({ username: 'admin_two', passwordHash, role: 'admin', status: 'active', now: 4 })).toThrow(/constraint/)
      expect(() => database.prepare(`INSERT INTO users (id, username, password_hash, role, status, password_changed_at, created_at, updated_at) VALUES (?, ?, ?, 'owner', 'active', 1, 1, 1)`).run('user-bad-role', 'bad_role', passwordHash)).toThrow()
      expect(() => database.prepare(`INSERT INTO users (id, username, password_hash, role, status, password_changed_at, created_at, updated_at) VALUES (?, ?, ?, 'member', 'approved', 1, 1, 1)`).run('user-bad-status', 'bad_status', passwordHash)).toThrow()
    } finally { database.close() }
  })

  it('enforces password lengths 9/10/128/129 and Argon2id m/t/p minima', async () => {
    await expect(hashPassword('a'.repeat(9))).rejects.toThrow(/10-128/)
    const minimum = await hashPassword('b'.repeat(10))
    expect(passwordHashMeetsPolicy(minimum)).toBe(true)
    expect(minimum).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    expect(ARGON2ID_POLICY).toMatchObject({ memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    expect(await verifyPassword(minimum, 'b'.repeat(10))).toBe(true)
    expect(await verifyPassword(minimum, 'c'.repeat(10))).toBe(false)
    const maximum = await hashPassword('d'.repeat(128))
    expect(await verifyPassword(maximum, 'd'.repeat(128))).toBe(true)
    await expect(hashPassword('e'.repeat(129))).rejects.toThrow(/10-128/)
  })
})

describe('P12 fixed database sessions and strict cookies', () => {
  it('stores only a unique SHA-256 token hash, uses absolute seven-day expiry and revokes immediately', async () => {
    const path = databasePath('p12-session')
    migrateDatabase(path)
    const database = openDatabase(path)
    try {
      const users = new UserRepository(database as never)
      const initialHash = await hashPassword('f'.repeat(10))
      const user = users.create({ username: 'session_user', passwordHash: initialHash, status: 'active', now: 1_000 })
      const sessions = new SessionRepository(database as never)
      const created = sessions.create(user.id, 2_000)
      expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(created.session).toMatchObject({ userId: user.id, createdAt: 2_000, expiresAt: 2_000 + SESSION_DURATION_MS })
      const stored = database.prepare('SELECT id, token_hash, expires_at, created_at FROM sessions').get() as { id: string; token_hash: string; expires_at: number; created_at: number }
      expect(stored.token_hash).toBe(hashSessionToken(created.token))
      expect(JSON.stringify(stored)).not.toContain(created.token)
      expect(stored.expires_at - stored.created_at).toBe(SESSION_DURATION_MS)
      expect(() => database.prepare('UPDATE sessions SET expires_at = ?, created_at = ? WHERE id = ?').run(4_000 + SESSION_DURATION_MS, 4_000, created.session.id)).toThrow(/fixed/)
      expect(sessions.validateToken(created.token, created.session.expiresAt - 1)?.user.username).toBe('session_user')
      expect(sessions.validateToken(created.token, created.session.expiresAt)).toBeNull()
      expect((database.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(created.session.id) as { expires_at: number }).expires_at).toBe(created.session.expiresAt)
      const tampered = `${created.token.slice(0, -1)}${created.token.endsWith('A') ? 'B' : 'A'}`
      expect(sessions.validateToken(tampered, 3_000)).toBeNull()
      expect(() => database.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run('session-duplicate', user.id, stored.token_hash, 3_000 + SESSION_DURATION_MS, 3_000)).toThrow()
      expect(sessions.revokeSession(created.session.id)).toBe(true)
      expect(sessions.validateToken(created.token, 3_000)).toBeNull()

      sessions.create(user.id, 4_000)
      sessions.create(user.id, 5_000)
      users.replacePasswordAndRevokeSessions(user.id, await hashPassword('g'.repeat(10)), 6_000)
      expect(scalar(database, 'SELECT count(*) AS count FROM sessions')).toBe(0)

      const beforeDisable = sessions.create(user.id, 6_500)
      users.disableAndRevokeSessions(user.id, 6_600)
      expect(scalar(database, 'SELECT count(*) AS count FROM sessions')).toBe(0)
      expect(sessions.validateToken(beforeDisable.token, 6_700)).toBeNull()

      const pending = users.create({ username: 'pending_user', passwordHash: initialHash, status: 'pending', now: 7_000 })
      expect(() => sessions.create(pending.id, 8_000)).toThrow(/Active user required/)
    } finally { database.close() }
  })

  it('serializes only __Host attributes and rejects malformed or duplicate Cookie headers', () => {
    const token = Buffer.alloc(32, 7).toString('base64url')
    const serialized = serializeSessionCookie(token)
    expect(serialized).toBe(`${SESSION_COOKIE_NAME}=${token}; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`)
    expect(serialized).not.toMatch(/Domain=/i)
    expect(parseSessionCookie(`${SESSION_COOKIE_NAME}=${token}`)).toBe(token)
    expect(parseSessionCookie(`theme=dark; ${SESSION_COOKIE_NAME}=${token}`)).toBe(token)
    expect(parseSessionCookie(`${SESSION_COOKIE_NAME}=${token}; ${SESSION_COOKIE_NAME}=${token}`)).toBeNull()
    for (const malformed of [
      `${SESSION_COOKIE_NAME}="${token}"`,
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(`${token}/`)}`,
      `${SESSION_COOKIE_NAME}=${token.slice(1)}`,
      `${SESSION_COOKIE_NAME}=${token}; broken`,
      `${SESSION_COOKIE_NAME}=${token}\r\nInjected=1`,
      `=${token}`,
      'x'.repeat(4_097),
    ]) expect(parseSessionCookie(malformed)).toBeNull()
    expect(parseSessionCookie('theme=dark')).toBeNull()
    expect(serializeClearedSessionCookie()).toBe(`${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`)
  })
})

describe('P12 persistent throttle and unopened route boundary', () => {
  it('persists a hashed throttle bucket across database reopen and never writes raw keys to diagnostics', () => {
    const path = databasePath('p12-throttle')
    migrateDatabase(path)
    const policy = { limit: 3, windowMs: 60_000, blockMs: 120_000 }
    const rawKey = 'login:127.0.0.1:throttle_user'
    const firstDatabase = openDatabase(path)
    const first = new PersistentAuthThrottle(firstDatabase as never)
    expect(first.consume(rawKey, policy, 1_000)).toMatchObject({ allowed: true, count: 1 })
    expect(first.consume(rawKey, policy, 2_000)).toMatchObject({ allowed: true, count: 2 })
    expect(first.consume(rawKey, policy, 3_000)).toMatchObject({ allowed: true, count: 3 })
    const blocked = first.consume(rawKey, policy, 4_000)
    expect(blocked).toMatchObject({ allowed: false, count: 4, blockedUntil: 124_000 })
    const row = firstDatabase.prepare('SELECT key_hash FROM auth_throttle').get() as { key_hash: string }
    expect(row.key_hash).toBe(hashThrottleKey(rawKey))
    expect(JSON.stringify(row)).not.toContain(rawKey)
    firstDatabase.close()

    const restartedDatabase = openDatabase(path)
    try {
      const restarted = new PersistentAuthThrottle(restartedDatabase as never)
      expect(restarted.consume(rawKey, policy, 5_000)).toMatchObject({ allowed: false, count: 4, blockedUntil: 124_000 })
      expect(restarted.consume(rawKey, policy, 124_000)).toMatchObject({ allowed: true, count: 1, blockedUntil: null })
      expect(scalar(restartedDatabase, 'SELECT count(*) AS count FROM audit_events')).toBe(0)
      expect((restartedDatabase.prepare("SELECT count(*) AS count FROM jobs WHERE diagnostic LIKE '%token%' OR diagnostic LIKE '%password%' OR diagnostic LIKE '%cookie%'").get() as { count: number }).count).toBe(0)
    } finally { restartedDatabase.close() }
  })

  it('keeps registration/admin/auth APIs at 404 and rejects hostile Origin before route lookup', async () => {
    const app = createApp()
    for (const path of ['/api/auth/register', '/api/auth/login', '/api/auth/session', '/api/admin/users']) {
      expect((await app.request(`http://127.0.0.1:3001${path}`, { method: 'POST' })).status).toBe(403)
      expect((await app.request(`http://127.0.0.1:3001${path}`, { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } })).status).toBe(404)
      expect((await app.request(`http://127.0.0.1:3001${path}`, { method: 'POST', headers: { origin: 'https://attacker.example' } })).status).toBe(403)
    }
  })

  it('removes Lucia from dependencies, lockfile and the retained source tree', () => {
    const sources = [
      'apps/api/package.json',
      'pnpm-lock.yaml',
      ...readdirSync(join(process.cwd(), 'apps/api/src/auth')).map((name) => `apps/api/src/auth/${name}`),
    ].map((path) => readFileSync(join(process.cwd(), path), 'utf8')).join('\n')
    expect(sources).not.toMatch(/\blucia\b|@lucia-auth/i)
    expect(existsSync(join(process.cwd(), 'apps/api/src/auth/lucia.ts'))).toBe(false)
  })
})
