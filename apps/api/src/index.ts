import { serve } from '@hono/node-server'
import { app, LOOPBACK_HOST } from './app.js'
import { migrateDatabase } from './db/migrate.js'
import { env } from './env.js'

migrateDatabase()

serve({
  fetch: app.fetch,
  hostname: LOOPBACK_HOST,
  port: env.port,
}, () => {
  console.log(`API server running on http://${LOOPBACK_HOST}:${env.port}`)
})

export default app
