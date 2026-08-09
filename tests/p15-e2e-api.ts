import { existsSync, mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from '../apps/api/src/app.js'
import { AuthApplicationService, bootstrapAdministrator } from '../apps/api/src/auth/service.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { AssetLibraryCatalog } from '../apps/api/src/assets/library-catalog.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { LocalJobRepository } from '../apps/api/src/jobs/local-jobs.js'
import { TEMPLATE_PREVIEW_JOB_TYPE, TemplatePreviewJobWorker } from '../apps/api/src/previews/preview-jobs.js'
import { PresentationExportRepository } from '../apps/api/src/presentation-exports/presentation-export-repository.js'
import { PresentationRepository } from '../apps/api/src/presentations/presentation-repository.js'
import { SecurePreviewRenderer } from '../apps/api/src/previews/secure-preview.js'
import { LocalRecoveryService } from '../apps/api/src/recovery/local-recovery.js'
import { adaptSimulatedTemplatePackage } from '../apps/api/src/templates/simulated-adapter.js'

type SQLite = { pragma(statement: string): unknown }
const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite
const chrome = process.env.P06_CHROMIUM_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function main(): Promise<void> {
  if (!existsSync(chrome)) throw new Error('P15 E2E requires local Chrome')
  const root = mkdtempSync(join(tmpdir(), 'asset-library-p15-e2e-'))
  const databasePath = join(root, 'asset-library.db')
  migrateDatabase(databasePath)
  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  const auth = new AuthApplicationService(database as never)
  await bootstrapAdministrator(database as never, { username: 'root_admin', password: 'admin-pass-1' })
  const store = new LocalContentStore(join(root, 'objects'))
  const template = adaptSimulatedTemplatePackage(join(process.cwd(), 'fixtures/p03-simulated-template'))
  const registered = new AssetCatalogRepository(database as never, store).registerTemplate(template)
  const jobs = new LocalJobRepository(database as never)
  jobs.enqueue({ id: 'p15-preview', type: TEMPLATE_PREVIEW_JOB_TYPE, inputSnapshot: { templateVersionId: template.version.id, contentObjectDigest: registered.contentObject.digest }, inputRevision: 0 })
  const worker = new TemplatePreviewJobWorker(database as never, jobs, store, new SecurePreviewRenderer({ chromiumExecutablePath: chrome, navigationTimeoutMs: 20_000 }), 'p15-worker', 60_000)
  await worker.runOnce()
  const app = createApp({
    catalog: new AssetLibraryCatalog(database as never, store),
    presentations: new PresentationRepository(database as never),
    exports: new PresentationExportRepository(database as never, store),
    recovery: new LocalRecoveryService({ databasePath, contentRoot: store.root, backupRoot: join(root, 'backups'), restoreRoot: join(root, 'restore') }),
    auth,
    allowedOrigins: ['http://localhost:5176'],
  })
  serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 3019 }, () => console.log('P15 fixture API ready'))
}
void main()
