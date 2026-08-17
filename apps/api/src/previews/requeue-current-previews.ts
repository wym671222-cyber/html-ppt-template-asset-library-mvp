import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { LOCAL_DATABASE_PATH } from '../db/paths.js'
import { LocalJobRepository } from '../jobs/local-jobs.js'
import { TEMPLATE_PREVIEW_JOB_TYPE } from './preview-jobs.js'

export const SCALED_THUMBNAIL_REFRESH_REVISION = 'scaled-v2'

type RefreshTarget = Readonly<{
  version_id: string
  version_number: number
  source_digest: string
  content_object_digest: string
}>

function refreshJobId(target: RefreshTarget): string {
  const identity = createHash('sha256')
    .update(`${SCALED_THUMBNAIL_REFRESH_REVISION}\u0000${target.version_id}\u0000${target.source_digest}`)
    .digest('hex')
  return `template-preview-refresh-${identity.slice(0, 32)}`
}

export function queueCurrentPreviewRefresh(database: Database.Database, expectedCount: number, apply: boolean): Readonly<{ targetCount: number; existingCount: number; queuedCount: number; applied: boolean }> {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1) throw new Error('Expected current template count must be a positive integer')
  if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('SQLite quick_check failed before preview refresh')
  database.pragma('foreign_keys = ON')
  if (database.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('SQLite foreign keys must be enabled before preview refresh')

  const targets = database.prepare(`
    SELECT version.id AS version_id, version.version_number, version.source_digest, version.content_object_digest
    FROM template_assets asset
    JOIN template_versions version ON version.id = asset.current_version_id AND version.asset_id = asset.id
    JOIN content_objects object ON object.digest = version.content_object_digest
    WHERE asset.status = 'active'
      AND version.status IN ('verified', 'available')
      AND version.source_digest = version.content_object_digest
      AND object.media_type = 'application/vnd.html-template-package+json'
    ORDER BY asset.id
  `).all() as RefreshTarget[]
  if (targets.length !== expectedCount) throw new Error(`Current template count changed: expected ${expectedCount}, received ${targets.length}`)

  const jobs = new LocalJobRepository(database)
  let existingCount = 0
  let queuedCount = 0
  database.transaction(() => {
    for (const target of targets) {
      const id = refreshJobId(target)
      const snapshot = { templateVersionId: target.version_id, contentObjectDigest: target.content_object_digest }
      const existing = jobs.get(id)
      if (existing) {
        if (existing.type !== TEMPLATE_PREVIEW_JOB_TYPE || JSON.stringify(existing.inputSnapshot) !== JSON.stringify(snapshot)) {
          throw new Error('Existing scaled-thumbnail refresh Job conflicts with the current template identity')
        }
        existingCount += 1
        continue
      }
      if (apply) jobs.enqueue({ id, type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: snapshot, inputRevision: target.version_number, maxAttempts: 2 })
      queuedCount += 1
    }
  })()
  return { targetCount: targets.length, existingCount, queuedCount, applied: apply }
}

function requiredExpectedCount(arguments_: string[]): number {
  const index = arguments_.indexOf('--expected-count')
  if (index < 0 || index + 1 >= arguments_.length || !/^[1-9][0-9]*$/.test(arguments_[index + 1])) {
    throw new Error('Usage: requeue-current-previews --expected-count <positive integer> [--apply]')
  }
  const allowed = new Set(['--expected-count', arguments_[index + 1], '--apply'])
  if (arguments_.some((argument) => !allowed.has(argument))) throw new Error('Unexpected preview refresh argument')
  return Number(arguments_[index + 1])
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expectedCount = requiredExpectedCount(process.argv.slice(2))
  const database = new Database(LOCAL_DATABASE_PATH, { fileMustExist: true })
  try {
    const result = queueCurrentPreviewRefresh(database, expectedCount, process.argv.includes('--apply'))
    console.log(JSON.stringify({ revision: SCALED_THUMBNAIL_REFRESH_REVISION, ...result }))
  } finally {
    database.close()
  }
}
