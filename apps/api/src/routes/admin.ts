import { Hono, type Context } from 'hono'
import type { UserStatus } from '@slide-maker/shared'
import { AuthApiError, type AuthAction, type AuthApplicationService } from '../auth/service.js'
import { createAdminMiddleware } from '../middleware/admin.js'
import { createAuthMiddleware, type AuthVariables } from '../middleware/auth.js'

const USER_ID = /^user-[0-9a-f-]{36}$/

function actionForPath(path: string): AuthAction {
  if (path.endsWith('/approve')) return 'admin.user_approve'
  if (path.endsWith('/disable')) return 'admin.user_disable'
  if (path.endsWith('/reset-password')) return 'admin.user_reset_password'
  return 'admin.users_list'
}

function errorResponse(context: Context, error: unknown): Response {
  const apiError = error instanceof AuthApiError ? error : new AuthApiError('AUTH_SERVICE_ERROR', 500)
  context.header('Cache-Control', 'no-store')
  if (apiError.status === 400) return context.json({ error: apiError.code }, 400)
  if (apiError.status === 401) return context.json({ error: apiError.code }, 401)
  if (apiError.status === 403) return context.json({ error: apiError.code }, 403)
  if (apiError.status === 404) return context.json({ error: apiError.code }, 404)
  if (apiError.status === 409) return context.json({ error: apiError.code }, 409)
  return context.json({ error: 'AUTH_SERVICE_ERROR' }, 500)
}

export function createAdminRouter(service: AuthApplicationService): Hono<AuthVariables> {
  const admin = new Hono<AuthVariables>()
  admin.use('*', async (context, next) => createAuthMiddleware(service, actionForPath(context.req.path))(context, next))
  admin.use('*', async (context, next) => createAdminMiddleware(service, actionForPath(context.req.path))(context, next))

  admin.get('/users', (context) => {
    const url = new URL(context.req.url)
    if ([...url.searchParams.keys()].some((key) => key !== 'status') || url.searchParams.getAll('status').length > 1) {
      service.recordFailure('admin.users_list', context.get('auth').user.id, 'INVALID_REQUEST')
      return context.json({ error: 'INVALID_REQUEST' }, 400)
    }
    const rawStatus = url.searchParams.get('status')
    if (rawStatus !== null && rawStatus !== 'pending' && rawStatus !== 'active' && rawStatus !== 'disabled') {
      service.recordFailure('admin.users_list', context.get('auth').user.id, 'INVALID_REQUEST')
      return context.json({ error: 'INVALID_REQUEST' }, 400)
    }
    try { return context.json({ users: service.listUsers(context.get('auth'), (rawStatus ?? undefined) as UserStatus | undefined) }) }
    catch (error) { return errorResponse(context, error) }
  })

  for (const [suffix, action] of [
    ['approve', 'admin.user_approve'],
    ['disable', 'admin.user_disable'],
    ['reset-password', 'admin.user_reset_password'],
  ] as const) {
    admin.post(`/users/:userId/${suffix}`, async (context) => {
      const userId = context.req.param('userId')
      if (new URL(context.req.url).search) {
        service.recordFailure(action, context.get('auth').user.id, 'INVALID_REQUEST')
        return context.json({ error: 'INVALID_REQUEST' }, 400)
      }
      if (!USER_ID.test(userId)) {
        service.recordFailure(action, context.get('auth').user.id, 'USER_NOT_FOUND')
        return context.json({ error: 'USER_NOT_FOUND' }, 404)
      }
      try {
        if (action === 'admin.user_approve') return context.json({ user: service.approveUser(context.get('auth'), userId) })
        if (action === 'admin.user_disable') return context.json({ user: service.disableUser(context.get('auth'), userId) })
        const result = await service.resetPassword(context.get('auth'), userId)
        context.header('Cache-Control', 'no-store')
        return context.json(result)
      } catch (error) { return errorResponse(context, error) }
    })
  }

  return admin
}
