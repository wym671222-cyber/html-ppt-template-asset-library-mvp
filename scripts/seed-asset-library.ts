#!/usr/bin/env tsx
// Register the P03 simulated fixture template into the production asset library,
// render its secure preview/thumbnail with Chromium, and verify the catalog query.
// Usage: tsx scripts/seed-asset-library.ts
import Database from 'better-sqlite3'
import { migrateDatabase, LOCAL_DATABASE_PATH } from '../apps/api/src/db/paths.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { LocalJobRepository } from '../apps/api/src/jobs/local-jobs.js'
import { TemplatePreviewJobWorker, TEMPLATE_PREVIEW_JOB_TYPE } from '../apps/api/src/previews/preview-jobs.js'
import { SecurePreviewRenderer } from '../apps/api/src/previews/secure-preview.js'
import { AssetLibraryCatalog } from '../apps/api/src/assets/library-catalog.js'
import { adaptSimulatedTemplatePackage } from '../apps/api/src/templates/simulated-adapter.js'
import { getOwnerContext } from '../apps/api/src/owner.js'
import { createId } from '@paralleldrive/cuid2'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const fixture = join(projectRoot, 'fixtures/p03-simulated-template')

async function main(): Promise<void> {
  console.log('DB path:', LOCAL_DATABASE_PATH)
  // Ensure schema exists (idempotent migrate on the real db)
  // Note: use the app's migrateDatabase from db/migrate for the fixed path.
  const { migrateDatabase: runMigrations } = await import('../apps/api/src/db/migrate.js')
  runMigrations(LOCAL_DATABASE_PATH)

  const sqlite = new Database(LOCAL_DATABASE_PATH)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const contentStore = new LocalContentStore()
  const repository = new AssetCatalogRepository(sqlite as never, contentStore)

  const template = adaptSimulatedTemplatePackage(fixture)
  const registered = repository.registerTemplate(template)
  console.log('Registered asset:', template.asset.id, 'version:', template.version.id, 'created:', registered.created)

  const jobs = new LocalJobRepository(sqlite as never)
  jobs.enqueue({
    id: createId(),
    type: TEMPLATE_PREVIEW_JOB_TYPE,
    inputSnapshot: {
      templateVersionId: template.version.id,
      contentObjectDigest: registered.contentObject.digest,
    },
    inputRevision: 0,
  })

  const renderer = new SecurePreviewRenderer()
  const worker = new TemplatePreviewJobWorker(sqlite as never, jobs, contentStore, renderer, 'seed-worker', 30_000)
  const didWork = await worker.runOnce()
  console.log('Preview job processed:', didWork)

  const catalog = new AssetLibraryCatalog(sqlite as never, contentStore)
  const response = catalog.list(getOwnerContext(), { search: '', category: null, tags: [], limit: 48 })
  console.log('Catalog total:', response.total)
  for (const item of response.items) {
    console.log('-', item.id, '|', item.title, '|', item.category, '| preview:', item.derivative.previewUrl)
  }
  sqlite.close()
}

main().catch((error) => {
  console.error('Seed failed:', error)
  process.exit(1)
})
