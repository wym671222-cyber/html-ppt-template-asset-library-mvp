import { serve } from '@hono/node-server'
import { createApp } from '../apps/api/src/app.js'
import { createTrustedTestAuth, seedTestUser } from './p14-test-support.js'

const port = Number(process.env.P02_API_PORT ?? 3017)
const user = seedTestUser({ prepare: () => ({ run: () => undefined }) } as never)
serve({ fetch: createApp({ auth: createTrustedTestAuth(user) }).fetch, hostname: '127.0.0.1', port }, () => {
  console.log(`P02 regression API ready at http://127.0.0.1:${port}`)
})
