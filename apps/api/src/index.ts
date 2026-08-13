import { serve } from '@hono/node-server'
import { createApp, LOOPBACK_HOST } from './app.js'
import { AssetLibraryCatalog } from './assets/library-catalog.js'
import { LocalContentStore } from './assets/content-store.js'
import { PresentationRepository } from './presentations/presentation-repository.js'
import { PresentationExportRepository } from './presentation-exports/presentation-export-repository.js'
import { migrateDatabase } from './db/migrate.js'
import { LOCAL_CONTENT_STORE_PATH, LOCAL_DATABASE_PATH, LOCAL_RECOVERY_BACKUP_PATH, LOCAL_RECOVERY_DRILL_PATH } from './db/paths.js'
import { LocalRecoveryService } from './recovery/local-recovery.js'
import { env } from './env.js'
import { AuthApplicationService } from './auth/service.js'
import { bootstrapPocketBayAdministrator } from './auth/pocketbay-bootstrap.js'

migrateDatabase()
const { sqlite } = await import('./db/index.js')

await bootstrapPocketBayAdministrator(sqlite)
const contentStore = new LocalContentStore()
const app = createApp({
  catalog: new AssetLibraryCatalog(sqlite, contentStore),
  presentations: new PresentationRepository(sqlite),
  exports: new PresentationExportRepository(sqlite, contentStore),
  recovery: new LocalRecoveryService({
    databasePath: LOCAL_DATABASE_PATH,
    contentRoot: LOCAL_CONTENT_STORE_PATH,
    backupRoot: LOCAL_RECOVERY_BACKUP_PATH,
    restoreRoot: LOCAL_RECOVERY_DRILL_PATH,
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
