import type { Context, Next } from 'hono'

// Legacy routes are not mounted by the production composition root. Keep their
// shared middleware fail-closed until P13 wires the new database session core.
export async function authMiddleware(context: Context, _next: Next) {
  return context.json({ error: 'Not found' }, 404)
}
