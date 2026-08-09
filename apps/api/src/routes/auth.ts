import { Hono } from 'hono'

// P12 deliberately exposes no identity endpoint. P13 will replace this
// fail-closed placeholder only after its API gate is active.
const auth = new Hono()
auth.all('*', (context) => context.json({ error: 'Not found' }, 404))

export default auth
