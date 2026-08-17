import { Hono, type Context } from 'hono'
import { AuthApiError, type AuthAction, type AuthApplicationService, resolveTrustedClientIp } from '../auth/service.js'
import { createAuthMiddleware, type AuthVariables } from '../middleware/auth.js'

const MAX_AUTH_JSON_BYTES = 2_048

async function exactJson(context: Context, keys: readonly string[]): Promise<Record<string, unknown>> {
  const text = await context.req.text()
  if (!text || Buffer.byteLength(text, 'utf8') > MAX_AUTH_JSON_BYTES) throw new AuthApiError('INVALID_REQUEST', 400)
  let body: unknown
  try { body = JSON.parse(text) } catch { throw new AuthApiError('INVALID_REQUEST', 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AuthApiError('INVALID_REQUEST', 400)
  if (Object.keys(body).sort().join(',') !== [...keys].sort().join(',')) throw new AuthApiError('INVALID_REQUEST', 400)
  return body as Record<string, unknown>
}

function errorResponse(context: Context, error: unknown, service: AuthApplicationService, action: AuthAction): Response {
  const apiError = error instanceof AuthApiError ? error : new AuthApiError('AUTH_SERVICE_ERROR', 500)
  if (!(error instanceof AuthApiError)) service.recordFailure(action, 'anonymous', apiError.code)
  context.header('Cache-Control', 'no-store')
  if (apiError.retryAfterSeconds !== undefined) context.header('Retry-After', String(apiError.retryAfterSeconds))
  if (apiError.status === 400) return context.json({ error: apiError.code }, 400)
  if (apiError.status === 401) return context.json({ error: apiError.code }, 401)
  if (apiError.status === 403) return context.json({ error: apiError.code }, 403)
  if (apiError.status === 404) return context.json({ error: apiError.code }, 404)
  if (apiError.status === 409) return context.json({ error: apiError.code }, 409)
  if (apiError.status === 429) return context.json({ error: apiError.code }, 429)
  return context.json({ error: 'AUTH_SERVICE_ERROR' }, 500)
}

export function createAuthRouter(service: AuthApplicationService, options: { registrationEnabled?: boolean } = {}): Hono<AuthVariables> {
  const auth = new Hono<AuthVariables>()
  const registrationEnabled = options.registrationEnabled ?? true

  auth.post('/register', async (context) => {
    if (!registrationEnabled) {
      context.header('Cache-Control', 'no-store')
      return context.json({ error: 'REGISTRATION_DISABLED' }, 403)
    }
    const ip = resolveTrustedClientIp(context.req.raw.headers)
    try {
      let body: Record<string, unknown>
      try {
        if (new URL(context.req.url).search) throw new AuthApiError('INVALID_REQUEST', 400)
        body = await exactJson(context, ['username', 'password'])
      } catch { throw service.rejectInvalidAuthRequest('auth.register', ip) }
      const user = await service.register({ username: body.username, password: body.password, ip })
      context.header('Cache-Control', 'no-store')
      return context.json({ user }, 201)
    } catch (error) { return errorResponse(context, error, service, 'auth.register') }
  })

  auth.post('/login', async (context) => {
    const ip = resolveTrustedClientIp(context.req.raw.headers)
    try {
      let body: Record<string, unknown>
      try {
        if (new URL(context.req.url).search) throw new AuthApiError('INVALID_REQUEST', 400)
        body = await exactJson(context, ['username', 'password'])
      } catch { throw service.rejectInvalidAuthRequest('auth.login', ip) }
      const result = await service.login({ username: body.username, password: body.password, ip })
      context.header('Set-Cookie', result.cookie)
      context.header('Cache-Control', 'no-store')
      return context.json({ user: result.user, session: result.session })
    } catch (error) { return errorResponse(context, error, service, 'auth.login') }
  })

  auth.get('/session', (context) => {
    if (new URL(context.req.url).search) return context.json({ error: 'INVALID_REQUEST' }, 400)
    const authenticated = service.authenticate(context.req.header('cookie'))
    context.header('Cache-Control', 'no-store')
    if (!authenticated) return context.json({ error: 'UNAUTHENTICATED' }, 401)
    return context.json({ user: authenticated.user, session: authenticated.session })
  })

  auth.post('/logout', (context) => {
    const authenticated = service.authenticate(context.req.header('cookie'))
    context.header('Set-Cookie', service.clearedCookie)
    context.header('Cache-Control', 'no-store')
    if (new URL(context.req.url).search) {
      service.recordFailure('auth.logout', authenticated?.user.id ?? 'anonymous', 'INVALID_REQUEST')
      return context.json({ error: 'INVALID_REQUEST' }, 400)
    }
    if (!authenticated) {
      service.recordFailure('auth.logout', 'anonymous', 'UNAUTHENTICATED')
      return context.body(null, 204)
    }
    try {
      service.logout(authenticated)
      return context.body(null, 204)
    } catch (error) { return errorResponse(context, error, service, 'auth.logout') }
  })

  auth.use('/change-password', createAuthMiddleware(service, 'auth.change_password'))
  auth.post('/change-password', async (context) => {
    try {
      let body: Record<string, unknown>
      try {
        if (new URL(context.req.url).search) throw new AuthApiError('INVALID_REQUEST', 400)
        body = await exactJson(context, ['currentPassword', 'newPassword'])
      } catch {
        service.recordFailure('auth.change_password', context.get('auth').user.id, 'INVALID_REQUEST')
        throw new AuthApiError('INVALID_REQUEST', 400)
      }
      await service.changePassword(context.get('auth'), { currentPassword: body.currentPassword, newPassword: body.newPassword })
      context.header('Set-Cookie', service.clearedCookie)
      context.header('Cache-Control', 'no-store')
      return context.body(null, 204)
    } catch (error) { return errorResponse(context, error, service, 'auth.change_password') }
  })

  return auth
}
