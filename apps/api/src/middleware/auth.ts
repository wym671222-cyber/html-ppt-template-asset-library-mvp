import type { Context, Next } from 'hono'
import type { AuthenticatedSession } from '../auth/sessions.js'
import type { AuthAction, AuthApplicationService } from '../auth/service.js'

export type AuthVariables = {
  Variables: {
    auth: AuthenticatedSession
  }
}

export function createAuthMiddleware(service: AuthApplicationService, action: AuthAction) {
  return async (context: Context<AuthVariables>, next: Next) => {
    const authenticated = service.authenticate(context.req.header('cookie'))
    if (!authenticated) {
      service.recordFailure(action, 'anonymous', 'UNAUTHENTICATED')
      context.header('Cache-Control', 'no-store')
      return context.json({ error: 'UNAUTHENTICATED' }, 401)
    }
    context.set('auth', authenticated)
    return next()
  }
}
