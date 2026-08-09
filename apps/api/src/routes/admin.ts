import { Hono } from 'hono'

// The retired CUNY administration surface stays unreachable in P12.
// P13 will introduce the approved username-only account administration API.
const admin = new Hono()
admin.all('*', (context) => context.json({ error: 'Not found' }, 404))

export default admin
