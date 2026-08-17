import { mkdtempSync, mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../apps/api/src/app.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { requireFixedDatabaseUrl } from '../apps/api/src/db/paths.js'
import { createTrustedTestAuth, seedTestUser, testOwner } from './p14-test-support.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): { run(...parameters: unknown[]): unknown; all(): unknown[] }
  exec(statement: string): void
  close(): void
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite

function temporaryDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), 'asset-library-p02-'))
  return join(directory, 'asset-library.db')
}

describe('P02 loopback composition root', () => {
  it('derives the owner from authenticated user context and excludes legacy collaboration routes', async () => {
    const user = seedTestUser({ prepare: () => ({ run: () => undefined }) } as never)
    const app = createApp({ auth: createTrustedTestAuth(user) })
    const owner = testOwner()
    expect(owner).toEqual({ id: user.id, kind: 'user' })

    const response = await app.request('http://127.0.0.1:3001/api/owner', {
      headers: { cookie: 'legacy-session=ignored', origin: 'http://127.0.0.1:5173' },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ owner })
    expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173')

    expect((await app.request('http://example.test/api/health')).status).toBe(421)
    expect((await app.request('http://127.0.0.1:3001/api/health', { headers: { origin: 'https://example.test' } })).status).toBe(403)
    expect((await app.request('http://127.0.0.1:3001/api/auth/login')).status).toBe(404)
    expect((await app.request('http://127.0.0.1:3001/api/decks/example/presence')).status).toBe(404)
    expect((await app.request('http://127.0.0.1:3001/api/providers')).status).toBe(404)
  })

  it('accepts only the fixed local SQLite path', () => {
    expect(() => requireFixedDatabaseUrl('file:/tmp/other.db')).toThrow('fixed local asset-library.db path')
    expect(requireFixedDatabaseUrl(undefined)).toMatch(/asset-library\.db$/)
  })
})

describe('P02 SQL migrations', () => {
  it('migrates an empty and then existing target database without changing the schema', () => {
    const path = temporaryDatabase()
    expect(migrateDatabase(path).existed).toBe(false)
    const repeated = migrateDatabase(path)
    expect(repeated.existed).toBe(true)
    expect(repeated.pendingMigrationCount).toBe(0)
    expect(repeated.backupPath).toBeUndefined()
    expect(repeated.backupSha256).toBeUndefined()

    const sqlite = new Database(path)
    try {
      sqlite.pragma('foreign_keys = ON')
      expect(sqlite.pragma('quick_check', { simple: true })).toBe('ok')
      expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
      const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
      const names = tables.map((table) => table.name)
      expect(names).toEqual(expect.arrayContaining(['template_assets', 'template_versions', 'presentation_items', 'content_objects', 'jobs', 'audit_events', 'users', 'sessions', 'auth_throttle']))
      expect(names.join(',')).not.toMatch(/organization|role_binding|approval|rbac/i)
      expect(sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: 8 })

      const now = Date.now()
      const user = seedTestUser(sqlite as never)
      const digest = 'a'.repeat(64)
      sqlite.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(digest, 'text/html', 1, 'objects/a.html', now)
      sqlite.prepare('INSERT INTO template_assets (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run('asset-1', 'Asset', now, now)
      sqlite.prepare("INSERT INTO template_versions (id, asset_id, version_number, contract_version, source_digest, content_object_digest, slot_schema, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)").run('version-1', 'asset-1', 1, 'v1', digest, digest, '{"slots":[{"id":"title","type":"text"}]}', now)
      expect(() => sqlite.prepare("UPDATE template_assets SET current_version_id = 'version-1' WHERE id = 'asset-1'").run()).toThrow(/current version must be verified/)
      sqlite.prepare("UPDATE template_versions SET status = 'verified' WHERE id = 'version-1'").run()
      sqlite.prepare("UPDATE template_assets SET current_version_id = 'version-1' WHERE id = 'asset-1'").run()
      expect(() => sqlite.prepare("UPDATE template_versions SET source_digest = ? WHERE id = 'version-1'").run('b'.repeat(64))).toThrow(/immutable/)
      expect(() => sqlite.prepare("DELETE FROM template_versions WHERE id = 'version-1'").run()).toThrow(/cannot be deleted/)

      sqlite.prepare('INSERT INTO presentations (id, owner_user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('presentation-1', user.id, 'Presentation', now, now)
      sqlite.prepare("INSERT INTO presentation_items (id, presentation_id, template_version_id, position, slot_overrides, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run('item-1', 'presentation-1', 'version-1', 0, '{"title":"Allowed"}', now, now)
      expect(() => sqlite.prepare("INSERT INTO presentation_items (id, presentation_id, template_version_id, position, slot_overrides, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run('item-2', 'presentation-1', 'version-1', 0, '{}', now, now)).toThrow(/UNIQUE constraint failed/)
      expect(() => sqlite.prepare("UPDATE presentation_items SET template_version_id = 'other' WHERE id = 'item-1'").run()).toThrow(/fixed/)
      expect(() => sqlite.prepare("UPDATE presentation_items SET slot_overrides = '{\"secret\":\"blocked\"}' WHERE id = 'item-1'").run()).toThrow(/undeclared slot/)

      sqlite.prepare("INSERT INTO jobs (id, type, status, input_snapshot, input_revision, attempt, output_digest, created_at) VALUES (?, ?, 'succeeded', ?, ?, ?, ?, ?)").run('job-1', 'validation', '{}', 0, 1, digest, now)
      expect(() => sqlite.prepare("UPDATE jobs SET status = 'failed' WHERE id = 'job-1'").run()).toThrow(/cannot overwrite verified output/)
      sqlite.prepare("INSERT INTO audit_events (id, action, entity_type, entity_id, result, created_at) VALUES (?, ?, ?, ?, 'success', ?)").run('event-1', 'migrate', 'database', 'asset-library', now)
      expect(() => sqlite.prepare("DELETE FROM audit_events WHERE id = 'event-1'").run()).toThrow(/append-only/)
    } finally {
      sqlite.close()
    }
  })

  it('backs up and stops when a non-target database is found', () => {
    const path = temporaryDatabase()
    const sqlite = new Database(path)
    sqlite.exec('CREATE TABLE legacy_unknown (id text PRIMARY KEY)')
    sqlite.close()

    expect(() => migrateDatabase(path)).toThrow(/unknown database tables: legacy_unknown/)
    const backups = readdirSync(join(dirname(path), 'backups'))
    expect(backups).toHaveLength(1)
  })
})
