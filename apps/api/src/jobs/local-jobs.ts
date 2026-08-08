import type BetterSqlite3 from 'better-sqlite3'

type Database = BetterSqlite3.Database
export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed'
export type LocalJob = Readonly<{ id: string; type: string; status: JobStatus; inputSnapshot: unknown; inputRevision: number; attempt: number; maxAttempts: number; diagnostic: string; outputDigest: string | null; leaseOwner: string | null; leaseExpiresAt: number | null }>
type JobRow = { id: string; type: string; status: JobStatus; input_snapshot: string; input_revision: number; attempt: number; max_attempts: number; diagnostic: string; output_digest: string | null; lease_owner: string | null; lease_expires_at: number | null }

function rowToJob(row: JobRow): LocalJob {
  return { id: row.id, type: row.type, status: row.status, inputSnapshot: JSON.parse(row.input_snapshot), inputRevision: row.input_revision, attempt: row.attempt, maxAttempts: row.max_attempts, diagnostic: row.diagnostic, outputDigest: row.output_digest, leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at }
}

export class LocalJobRepository {
  constructor(private readonly database: Database, private readonly now: () => number = Date.now) {}

  enqueue(job: { id: string; type: string; inputSnapshot: unknown; inputRevision: number; maxAttempts?: number }): void {
    if (!Number.isInteger(job.inputRevision) || job.inputRevision < 0) throw new Error('Job input revision must be non-negative')
    const maxAttempts = job.maxAttempts ?? 3
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('Job max attempts must be at least one')
    this.database.prepare("INSERT INTO jobs (id, type, status, input_snapshot, input_revision, attempt, max_attempts, created_at) VALUES (?, ?, 'pending', ?, ?, 0, ?, ?)").run(job.id, job.type, JSON.stringify(job.inputSnapshot), job.inputRevision, maxAttempts, this.now())
  }

  recoverExpired(): void {
    const now = this.now()
    this.database.transaction(() => {
      this.database.prepare("UPDATE jobs SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL, diagnostic = 'lease expired; retry pending' WHERE status = 'running' AND lease_expires_at <= ? AND attempt < max_attempts").run(now)
      this.database.prepare("UPDATE jobs SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, diagnostic = 'lease expired; retry limit reached' WHERE status = 'running' AND lease_expires_at <= ? AND attempt >= max_attempts").run(now, now)
    })()
  }

  claim(workerId: string, leaseMs: number, jobTypes?: readonly string[]): LocalJob | undefined {
    if (!workerId || leaseMs < 1) throw new Error('Worker id and positive lease duration are required')
    if (jobTypes && (jobTypes.length === 0 || jobTypes.some((type) => !type))) throw new Error('Job type filter must contain non-empty values')
    this.recoverExpired()
    return this.database.transaction(() => {
      const typeFilter = jobTypes ? ` AND type IN (${jobTypes.map(() => '?').join(', ')})` : ''
      const row = this.database.prepare(`SELECT id FROM jobs WHERE status = 'pending'${typeFilter} ORDER BY created_at, id LIMIT 1`).get(...(jobTypes ?? [])) as { id: string } | undefined
      if (!row) return undefined
      const now = this.now()
      const result = this.database.prepare("UPDATE jobs SET status = 'running', attempt = attempt + 1, started_at = ?, lease_owner = ?, lease_expires_at = ?, diagnostic = '' WHERE id = ? AND status = 'pending'").run(now, workerId, now + leaseMs, row.id)
      if (result.changes !== 1) return undefined
      return rowToJob(this.database.prepare('SELECT id, type, status, input_snapshot, input_revision, attempt, max_attempts, diagnostic, output_digest, lease_owner, lease_expires_at FROM jobs WHERE id = ?').get(row.id) as JobRow)
    })()
  }

  succeed(jobId: string, workerId: string, outputDigest: string): void {
    const object = this.database.prepare('SELECT digest FROM content_objects WHERE digest = ?').get(outputDigest)
    if (!object) throw new Error('Successful job output must reference a verified content object')
    const result = this.database.prepare("UPDATE jobs SET status = 'succeeded', output_digest = ?, lease_owner = NULL, lease_expires_at = NULL, finished_at = ? WHERE id = ? AND status = 'running' AND lease_owner = ?").run(outputDigest, this.now(), jobId, workerId)
    if (result.changes !== 1) throw new Error('Job success rejected because its lease is no longer held')
  }

  fail(jobId: string, workerId: string, diagnostic: string, retryable = true): void {
    const result = this.database.prepare("UPDATE jobs SET status = CASE WHEN ? AND attempt < max_attempts THEN 'pending' ELSE 'failed' END, diagnostic = ?, lease_owner = NULL, lease_expires_at = NULL, finished_at = CASE WHEN ? AND attempt < max_attempts THEN NULL ELSE ? END WHERE id = ? AND status = 'running' AND lease_owner = ?").run(retryable ? 1 : 0, diagnostic.slice(0, 500), retryable ? 1 : 0, this.now(), jobId, workerId)
    if (result.changes !== 1) throw new Error('Job failure rejected because its lease is no longer held')
  }

  get(jobId: string): LocalJob | undefined {
    const row = this.database.prepare('SELECT id, type, status, input_snapshot, input_revision, attempt, max_attempts, diagnostic, output_digest, lease_owner, lease_expires_at FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined
    return row && rowToJob(row)
  }
}

export class LocalJobWorker {
  constructor(private readonly jobs: LocalJobRepository, private readonly workerId: string, private readonly leaseMs: number, private readonly handler: (job: LocalJob) => Promise<{ outputDigest: string }>) {}

  async runOnce(): Promise<boolean> {
    const job = this.jobs.claim(this.workerId, this.leaseMs)
    if (!job) return false
    try {
      this.jobs.succeed(job.id, this.workerId, (await this.handler(job)).outputDigest)
    } catch {
      this.jobs.fail(job.id, this.workerId, 'local worker handler failed')
    }
    return true
  }
}
