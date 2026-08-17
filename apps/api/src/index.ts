import { serve } from '@hono/node-server'
import { createApp, LOOPBACK_HOST } from './app.js'
import { AssetLibraryCatalog } from './assets/library-catalog.js'
import { AssetCatalogRepository } from './assets/catalog-repository.js'
import { LocalContentStore } from './assets/content-store.js'
import { PresentationRepository } from './presentations/presentation-repository.js'
import { PresentationExportRepository } from './presentation-exports/presentation-export-repository.js'
import { migrateDatabase } from './db/migrate.js'
import { LOCAL_CONTENT_STORE_PATH, LOCAL_DATABASE_PATH, LOCAL_RECOVERY_BACKUP_PATH, LOCAL_RECOVERY_DRILL_PATH } from './db/paths.js'
import { LocalRecoveryService } from './recovery/local-recovery.js'
import { env } from './env.js'
import { AuthApplicationService } from './auth/service.js'
import { bootstrapPocketBayAdministrator } from './auth/pocketbay-bootstrap.js'
import { LocalJobRepository } from './jobs/local-jobs.js'
import { TemplatePreviewJobWorker } from './previews/preview-jobs.js'
import { SecurePreviewRenderer } from './previews/secure-preview.js'
import { TemplateImportService } from './templates/template-import.js'
import { CatalogTransferService } from './assets/catalog-transfer.js'
import { LOCAL_CATALOG_TRANSFER_STAGING_PATH } from './db/paths.js'

const recovery = new LocalRecoveryService({
  databasePath: LOCAL_DATABASE_PATH,
  contentRoot: LOCAL_CONTENT_STORE_PATH,
  backupRoot: LOCAL_RECOVERY_BACKUP_PATH,
  restoreRoot: LOCAL_RECOVERY_DRILL_PATH,
})
const appliedRecovery = recovery.applyPendingActivation()
if (appliedRecovery) console.log(JSON.stringify({ event: 'recovery_activation_applied', id: appliedRecovery.id, backupId: appliedRecovery.backupId }))
migrateDatabase()
const { sqlite } = await import('./db/index.js')

await bootstrapPocketBayAdministrator(sqlite)
const contentStore = new LocalContentStore()
const jobs = new LocalJobRepository(sqlite)
const chromiumExecutablePath = process.env.CHROMIUM_EXECUTABLE_PATH
if (process.env.POCKETBAY_RUNTIME === 'true' && chromiumExecutablePath !== '/usr/bin/chromium') throw new Error('PocketBay template preview requires CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium')
const previewWorker = new TemplatePreviewJobWorker(
  sqlite,
  jobs,
  contentStore,
  new SecurePreviewRenderer({ chromiumExecutablePath, navigationTimeoutMs: 20_000 }),
  `template-preview-${process.pid}`,
  60_000,
)
let previewWorkerBusy = false
async function pumpPreviewQueue(): Promise<void> {
  if (previewWorkerBusy) return
  previewWorkerBusy = true
  try {
    while (await previewWorker.runOnce()) { /* Single worker drains the bounded local queue. */ }
  } catch {
    console.error(JSON.stringify({ event: 'template_preview_worker_error' }))
  } finally { previewWorkerBusy = false }
}
const previewTimer = setInterval(() => { void pumpPreviewQueue() }, 1_000)
previewTimer.unref()
void pumpPreviewQueue()
const app = createApp({
  catalog: new AssetLibraryCatalog(sqlite, contentStore),
  presentations: new PresentationRepository(sqlite),
  exports: new PresentationExportRepository(sqlite, contentStore),
  recovery,
  templateImports: new TemplateImportService(sqlite, new AssetCatalogRepository(sqlite, contentStore), jobs),
  catalogTransfers: new CatalogTransferService({
    database: sqlite,
    contentStore,
    stagingRoot: LOCAL_CATALOG_TRANSFER_STAGING_PATH,
    sourceReleaseSha: process.env.SOURCE_RELEASE_SHA ?? '',
    readOnly: env.appReadOnly,
  }),
  auth: new AuthApplicationService(sqlite),
  allowedOrigins: [env.appOrigin],
  registrationEnabled: env.registrationEnabled,
  readOnly: env.appReadOnly,
  readiness: () => {
    sqlite.prepare('SELECT 1').get()
  },
})

serve({
  fetch: app.fetch,
  hostname: LOOPBACK_HOST,
  port: env.port,
}, () => {
  console.log(JSON.stringify({
    event: 'api_started',
    host: LOOPBACK_HOST,
    port: env.port,
    readOnly: env.appReadOnly,
  }))
})

export default app
