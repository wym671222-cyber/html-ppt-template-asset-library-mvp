import type { Context, Next } from 'hono'
import type { AuthAction, AuthApplicationService } from '../auth/service.js'
import type { AuthVariables } from './auth.js'

export function createAdminMiddleware(service: AuthApplicationService, action: AuthAction) {
  return async (context: Context<AuthVariables>, next: Next) => {
    const authenticated = context.get('auth')
    if (authenticated.user.role !== 'admin') {
      service.recordFailure(action, authenticated.user.id, 'FORBIDDEN')
      context.header('Cache-Control', 'no-store')
      return context.json({ error: 'FORBIDDEN' }, 403)
    }
    if (authenticated.user.mustChangePassword) {
      service.recordFailure(action, authenticated.user.id, 'PASSWORD_CHANGE_REQUIRED')
      context.header('Cache-Control', 'no-store')
      return context.json({ error: 'PASSWORD_CHANGE_REQUIRED' }, 403)
    }
    return next()
  }
}
