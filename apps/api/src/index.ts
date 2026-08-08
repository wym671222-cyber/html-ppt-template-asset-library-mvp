import { serve } from '@hono/node-server'
import { createApp, LOOPBACK_HOST } from './app.js'
import { AssetLibraryCatalog } from './assets/library-catalog.js'
import { LocalContentStore } from './assets/content-store.js'
import { PresentationRepository } from './presentations/presentation-repository.js'
import { PresentationExportRepository } from './presentation-exports/presentation-export-repository.js'
import { migrateDatabase } from './db/migrate.js'
import { env } from './env.js'

migrateDatabase()
const { sqlite } = await import('./db/index.js')
const contentStore = new LocalContentStore()
const app = createApp({
  catalog: new AssetLibraryCatalog(sqlite, contentStore),
  presentations: new PresentationRepository(sqlite),
  exports: new PresentationExportRepository(sqlite, contentStore),
})

serve({
  fetch: app.fetch,
  hostname: LOOPBACK_HOST,
  port: env.port,
}, () => {
  console.log(`API server running on http://${LOOPBACK_HOST}:${env.port}`)
})

export default app
