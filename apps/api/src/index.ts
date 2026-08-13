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
import { AuthApiError, AuthApplicationService, bootstrapAdministrator } from './auth/service.js'

migrateDatabase()
const { sqlite } = await import('./db/index.js')

async function bootstrapPocketBayAdministrator(): Promise<void> {
  if (process.env.POCKETBAY_RUNTIME !== 'true') return
  const username = process.env.POCKETBAY_ADMIN_USERNAME?.trim()
  const password = process.env.POCKETBAY_ADMIN_PASSWORD
  if (!username && !password) return
  if (!username || !password) throw new Error('PocketBay administrator bootstrap requires both username and password')
  try {
    await bootstrapAdministrator(sqlite, { username, password })
  } catch (error) {
    if (!(error instanceof AuthApiError) || error.code !== 'ADMIN_ALREADY_EXISTS') throw error
  } finally {
    delete process.env.POCKETBAY_ADMIN_USERNAME
    delete process.env.POCKETBAY_ADMIN_PASSWORD
  }
}

await bootstrapPocketBayAdministrator()
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
