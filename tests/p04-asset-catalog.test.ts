import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { LocalJobRepository, LocalJobWorker } from '../apps/api/src/jobs/local-jobs.js'
import { adaptSimulatedTemplatePackage } from '../apps/api/src/templates/simulated-adapter.js'

type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): { get(...parameters: unknown[]): unknown; run(...parameters: unknown[]): { changes: number } }
  close(): void
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite
const fixture = join(process.cwd(), 'fixtures/p03-simulated-template')

function temporaryDatabase(): string {
  return join(mkdtempSync(join(tmpdir(), 'asset-library-p04-')), 'asset-library.db')
}

function openMigratedDatabase(): SQLite {
  const path = temporaryDatabase()
  migrateDatabase(path)
  const database = new Database(path)
  database.pragma('foreign_keys = ON')
  return database
}

describe('P04 local SHA-256 content store', () => {
  it('deduplicates exact bytes, rejects unsafe digests, detects tampering, and leaves no half-object after a store failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-library-p04-cas-'))
    const store = new LocalContentStore(root)
    const first = store.put(Buffer.from('same content'), 'text/plain')
    const repeated = store.put(Buffer.from('same content'), 'text/plain')
    const different = store.put(Buffer.from('different content'), 'text/plain')
    expect(repeated.digest).toBe(first.digest)
    expect(different.digest).not.toBe(first.digest)
    expect(store.read(first.digest).toString()).toBe('same content')
    expect(() => store.read('../outside')).toThrow(/SHA-256/)

    writeFileSync(join(root, first.relativePath), 'tampered')
    expect(() => store.read(first.digest)).toThrow(/integrity check failed/)

    const blockedRoot = join(root, 'not-a-directory')
    writeFileSync(blockedRoot, 'block writes')
    expect(() => new LocalContentStore(blockedRoot).put(Buffer.from('must not persist'), 'text/plain')).toThrow()
    expect(readFileSync(blockedRoot, 'utf8')).toBe('block writes')
    expect(existsSync(join(root, 'not-a-directory', 'sha256'))).toBe(false)
  })
})

describe('P04 asset catalog repository', () => {
  it('registers the P03 fixture atomically and makes exact re-registration idempotent', () => {
    const database = openMigratedDatabase()
    try {
      const store = new LocalContentStore(mkdtempSync(join(tmpdir(), 'asset-library-p04-objects-')))
      const repository = new AssetCatalogRepository(database as never, store)
      const template = adaptSimulatedTemplatePackage(fixture)
      const first = repository.registerTemplate(template)
      const repeated = repository.registerTemplate(template)
      expect(first.created).toBe(true)
      expect(repeated.created).toBe(false)
      expect(first.contentObject.digest).toBe(template.version.sourceDigest)
      expect(store.read(first.sourceDigest)).toEqual(expect.any(Buffer))
      expect(database.prepare('SELECT count(*) AS count FROM content_objects').get()).toEqual({ count: 1 })
      expect(database.prepare('SELECT count(*) AS count FROM template_versions').get()).toEqual({ count: 1 })
      expect(database.prepare('SELECT current_version_id FROM template_assets WHERE id = ?').get(template.asset.id)).toEqual({ current_version_id: template.version.id })
      expect(database.prepare('SELECT content_object_digest, status FROM template_versions WHERE id = ?').get(template.version.id)).toEqual({ content_object_digest: first.sourceDigest, status: 'verified' })

      expect(() => repository.registerTemplate({ ...template, asset: { ...template.asset, title: 'conflicting title' } })).toThrow(/immutable/)
      expect(database.prepare('SELECT count(*) AS count FROM template_versions').get()).toEqual({ count: 1 })
    } finally {
      database.close()
    }
  })
})

describe('P04 SQLite jobs and local worker', () => {
  it('claims one lease, recovers a simulated crash, retries safely, and preserves successful output', async () => {
    const database = openMigratedDatabase()
    try {
      const store = new LocalContentStore(mkdtempSync(join(tmpdir(), 'asset-library-p04-job-objects-')))
      const output = store.put(Buffer.from('worker output'), 'text/plain')
      database.prepare('INSERT INTO content_objects (digest, media_type, byte_size, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(output.digest, output.mediaType, output.byteSize, output.relativePath, 1)
      let now = 100
      const jobs = new LocalJobRepository(database as never, () => now)
      jobs.enqueue({ id: 'crash-job', type: 'fixture', inputSnapshot: { fixture: true }, inputRevision: 0, maxAttempts: 2 })
      expect(jobs.claim('worker-a', 10)).toMatchObject({ status: 'running', attempt: 1, leaseOwner: 'worker-a' })
      expect(jobs.claim('worker-b', 10)).toBeUndefined()
      now = 111
      jobs.recoverExpired()
      expect(jobs.get('crash-job')).toMatchObject({ status: 'pending', attempt: 1 })
      expect(jobs.claim('worker-b', 10)).toMatchObject({ status: 'running', attempt: 2, leaseOwner: 'worker-b' })
      now = 122
      jobs.recoverExpired()
      expect(jobs.get('crash-job')).toMatchObject({ status: 'failed', attempt: 2 })

      jobs.enqueue({ id: 'worker-job', type: 'fixture', inputSnapshot: {}, inputRevision: 0, maxAttempts: 2 })
      const worker = new LocalJobWorker(jobs, 'worker-c', 20, async () => ({ outputDigest: output.digest }))
      await expect(worker.runOnce()).resolves.toBe(true)
      expect(jobs.get('worker-job')).toMatchObject({ status: 'succeeded', outputDigest: output.digest })
      expect(() => jobs.fail('worker-job', 'worker-c', 'late retry')).toThrow(/lease is no longer held/)

      jobs.enqueue({ id: 'retry-job', type: 'fixture', inputSnapshot: {}, inputRevision: 0, maxAttempts: 2 })
      expect(jobs.claim('worker-d', 20)).toBeDefined()
      jobs.fail('retry-job', 'worker-d', 'retry once')
      expect(jobs.get('retry-job')).toMatchObject({ status: 'pending', attempt: 1 })
      expect(jobs.claim('worker-d', 20)).toBeDefined()
      jobs.fail('retry-job', 'worker-d', 'terminal failure')
      expect(jobs.get('retry-job')).toMatchObject({ status: 'failed', attempt: 2 })
    } finally {
      database.close()
    }
  })
})
