import { serve } from '@hono/node-server'
import { createApp } from '../apps/api/src/app.js'

const port = Number(process.env.P02_API_PORT ?? 3017)
serve({ fetch: createApp().fetch, hostname: '127.0.0.1', port }, () => {
  console.log(`P02 regression API ready at http://127.0.0.1:${port}`)
})
