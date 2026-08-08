import { serve } from '@hono/node-server'
import { createApp, LOOPBACK_HOST } from './app.js'
import { AssetLibraryCatalog } from './assets/library-catalog.js'
import { LocalContentStore } from './assets/content-store.js'
import { migrateDatabase } from './db/migrate.js'
import { env } from './env.js'

migrateDatabase()
const { sqlite } = await import('./db/index.js')
const app = createApp({ catalog: new AssetLibraryCatalog(sqlite, new LocalContentStore()) })

serve({
  fetch: app.fetch,
  hostname: LOOPBACK_HOST,
  port: env.port,
}, () => {
  console.log(`API server running on http://${LOOPBACK_HOST}:${env.port}`)
})

export default app
