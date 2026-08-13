import { isIP } from 'node:net'
import { randomBytes } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import type { User, UserStatus } from '@slide-maker/shared'
import { AuditEventWriter } from './audit.js'
import { hashPassword, PasswordValidationError, verifyPassword } from './password.js'
import { serializeClearedSessionCookie } from './cookie.js'
import { type AuthenticatedSession, type CreatedSession, SessionRepository } from './sessions.js'
import { PersistentAuthThrottle, type ThrottleDecision } from './throttle.js'
import { AuthDataError, normalizeUsername, publicUser, type StoredUser, UserRepository } from './users.js'

type Database = BetterSqlite3.Database

export type AuthAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.change_password'
  | 'admin.users_list'
  | 'admin.user_approve'
  | 'admin.user_disable'
  | 'admin.user_reset_password'
  | 'auth.bootstrap_admin'
  | 'security.origin'
  | 'business.access'
  | 'recovery.access'
  | 'template-import.access'

export type AuthErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500
// Internal-only hop contract: the P15 BFF must remove any inbound copy and inject
// exactly one validated address while the API remains bound to the loopback hop.
export const TRUSTED_CLIENT_IP_HEADER = 'x-ppt-client-ip'

export class AuthApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: AuthErrorStatus,
    readonly retryAfterSeconds?: number,
  ) {
    super(code)
  }
}

const REGISTER_POLICY = Object.freeze({ limit: 3, windowMs: 60 * 60 * 1_000, blockMs: 1 })
const LOGIN_USERNAME_POLICY = Object.freeze({ limit: 5, windowMs: 15 * 60 * 1_000, blockMs: 1 })
const LOGIN_IP_POLICY = Object.freeze({ limit: 20, windowMs: 15 * 60 * 1_000, blockMs: 1 })
const DUMMY_PASSWORD_HASH = hashPassword('invalid-credential')

function safeIp(value: unknown): string {
  return typeof value === 'string' && isIP(value) !== 0 ? value : 'unknown'
}

function retryAfterSeconds(...decisions: ThrottleDecision[]): number {
  return Math.max(1, Math.ceil(Math.max(...decisions.map((decision) => decision.retryAfterMs)) / 1_000))
}

function temporaryPassword(): string {
  return randomBytes(18).toString('base64url')
}

export class AuthApplicationService {
  readonly clearedCookie = serializeClearedSessionCookie()
  private readonly users: UserRepository
  private readonly sessions: SessionRepository
  private readonly throttle: PersistentAuthThrottle
  private readonly audit: AuditEventWriter

  constructor(private readonly database: Database) {
    this.users = new UserRepository(database)
    this.sessions = new SessionRepository(database)
    this.throttle = new PersistentAuthThrottle(database)
    this.audit = new AuditEventWriter(database)
  }

  recordFailure(action: AuthAction, entityId: string, diagnostic: string, now = Date.now()): void {
    this.audit.record({ action, entityType: entityId.startsWith('user-') ? 'user' : 'request', entityId, result: 'failure', diagnostic, now })
  }

  authenticate(cookieHeader: string | null | undefined, now = Date.now()): AuthenticatedSession | null {
    return this.sessions.validateCookie(cookieHeader, now)
  }

  rejectInvalidAuthRequest(action: 'auth.register' | 'auth.login', ipValue: unknown, now = Date.now()): AuthApiError {
    const ip = safeIp(ipValue)
    const decisions = action === 'auth.register'
      ? [this.throttle.consume(`register:ip:${ip}`, REGISTER_POLICY, now)]
      : [
          this.throttle.consume(`login:ip-username:${ip}:invalid`, LOGIN_USERNAME_POLICY, now),
          this.throttle.consume(`login:ip:${ip}`, LOGIN_IP_POLICY, now),
        ]
    const blocked = decisions.some((decision) => !decision.allowed)
    const code = blocked ? 'RATE_LIMITED' : 'INVALID_REQUEST'
    this.recordFailure(action, 'anonymous', code, now)
    return new AuthApiError(code, blocked ? 429 : 400, blocked ? retryAfterSeconds(...decisions) : undefined)
  }

  async register(input: { username: unknown; password: unknown; ip: unknown; now?: number }): Promise<User> {
    const now = input.now ?? Date.now()
    const ip = safeIp(input.ip)
    const decision = this.throttle.consume(`register:ip:${ip}`, REGISTER_POLICY, now)
    if (!decision.allowed) {
      this.recordFailure('auth.register', 'anonymous', 'RATE_LIMITED', now)
      throw new AuthApiError('RATE_LIMITED', 429, retryAfterSeconds(decision))
    }
    try {
      const username = normalizeUsername(input.username)
      const passwordHash = await hashPassword(input.password)
      return this.database.transaction(() => {
        const user = this.users.create({ username, passwordHash, role: 'member', status: 'pending', now })
        this.audit.record({ action: 'auth.register', entityType: 'user', entityId: user.id, result: 'success', diagnostic: 'REGISTERED_PENDING', now })
        return publicUser(user)
      }).immediate()
    } catch (error) {
      const code = error instanceof PasswordValidationError ? 'PASSWORD_POLICY' : error instanceof AuthDataError ? 'REGISTRATION_REJECTED' : 'AUTH_SERVICE_ERROR'
      const status: AuthErrorStatus = code === 'PASSWORD_POLICY' ? 400 : code === 'REGISTRATION_REJECTED' ? 409 : 500
      this.recordFailure('auth.register', 'anonymous', code, now)
      throw new AuthApiError(code, status)
    }
  }

  async login(input: { username: unknown; password: unknown; ip: unknown; now?: number }): Promise<CreatedSession & { user: User }> {
    const now = input.now ?? Date.now()
    const ip = safeIp(input.ip)
    let username: string
    try { username = normalizeUsername(input.username) } catch { username = 'invalid' }
    const byUsername = this.throttle.consume(`login:ip-username:${ip}:${username}`, LOGIN_USERNAME_POLICY, now)
    const byIp = this.throttle.consume(`login:ip:${ip}`, LOGIN_IP_POLICY, now)
    if (!byUsername.allowed || !byIp.allowed) {
      this.recordFailure('auth.login', 'anonymous', 'RATE_LIMITED', now)
      throw new AuthApiError('RATE_LIMITED', 429, retryAfterSeconds(byUsername, byIp))
    }

    let user: StoredUser | null = null
    try { user = username === 'invalid' ? null : this.users.findByUsername(username) } catch { user = null }
    const passwordHash = user?.passwordHash ?? await DUMMY_PASSWORD_HASH
    const passwordValid = await verifyPassword(passwordHash, input.password)
    if (!user || !passwordValid) {
      this.recordFailure('auth.login', 'anonymous', 'INVALID_CREDENTIALS', now)
      throw new AuthApiError('INVALID_CREDENTIALS', 401)
    }
    if (user.status === 'pending') {
      this.recordFailure('auth.login', user.id, 'ACCOUNT_PENDING', now)
      throw new AuthApiError('ACCOUNT_PENDING', 403)
    }
    if (user.status === 'disabled') {
      this.recordFailure('auth.login', user.id, 'ACCOUNT_DISABLED', now)
      throw new AuthApiError('ACCOUNT_DISABLED', 403)
    }
    try {
      return this.database.transaction(() => {
        const created = this.sessions.create(user.id, now)
        this.audit.record({ action: 'auth.login', entityType: 'user', entityId: user.id, result: 'success', diagnostic: 'SESSION_CREATED', now })
        return { ...created, user: publicUser(user) }
      }).immediate()
    } catch {
      this.recordFailure('auth.login', user.id, 'AUTH_SERVICE_ERROR', now)
      throw new AuthApiError('AUTH_SERVICE_ERROR', 500)
    }
  }

  logout(authenticated: AuthenticatedSession, now = Date.now()): void {
    try {
      this.database.transaction(() => {
        this.sessions.revokeSession(authenticated.session.id)
        this.audit.record({ action: 'auth.logout', entityType: 'user', entityId: authenticated.user.id, result: 'success', diagnostic: 'SESSION_REVOKED', now })
      }).immediate()
    } catch {
      this.recordFailure('auth.logout', authenticated.user.id, 'AUTH_SERVICE_ERROR', now)
      throw new AuthApiError('AUTH_SERVICE_ERROR', 500)
    }
  }

  async changePassword(authenticated: AuthenticatedSession, input: { currentPassword: unknown; newPassword: unknown; now?: number }): Promise<void> {
    const now = input.now ?? Date.now()
    const user = this.users.read(authenticated.user.id)
    if (!await verifyPassword(user.passwordHash, input.currentPassword)) {
      this.recordFailure('auth.change_password', user.id, 'INVALID_CREDENTIALS', now)
      throw new AuthApiError('INVALID_CREDENTIALS', 401)
    }
    if (await verifyPassword(user.passwordHash, input.newPassword)) {
      this.recordFailure('auth.change_password', user.id, 'NEW_PASSWORD_REQUIRED', now)
      throw new AuthApiError('NEW_PASSWORD_REQUIRED', 400)
    }
    let passwordHash: string
    try { passwordHash = await hashPassword(input.newPassword) } catch {
      this.recordFailure('auth.change_password', user.id, 'PASSWORD_POLICY', now)
      throw new AuthApiError('PASSWORD_POLICY', 400)
    }
    try {
      this.database.transaction(() => {
        this.users.replacePasswordAndRevokeSessions(user.id, passwordHash, now, false)
        this.audit.record({ action: 'auth.change_password', entityType: 'user', entityId: user.id, result: 'success', diagnostic: 'PASSWORD_CHANGED', now })
      }).immediate()
    } catch {
      this.recordFailure('auth.change_password', user.id, 'AUTH_SERVICE_ERROR', now)
      throw new AuthApiError('AUTH_SERVICE_ERROR', 500)
    }
  }

  listUsers(admin: AuthenticatedSession, status: UserStatus | undefined, now = Date.now()): User[] {
    this.assertAdmin(admin, 'admin.users_list', now)
    try {
      const users = this.users.list(status).map(publicUser)
      this.audit.record({ action: 'admin.users_list', entityType: 'user', entityId: admin.user.id, result: 'success', diagnostic: 'USERS_LISTED', now })
      return users
    } catch {
      this.recordFailure('admin.users_list', admin.user.id, 'AUTH_SERVICE_ERROR', now)
      throw new AuthApiError('AUTH_SERVICE_ERROR', 500)
    }
  }

  approveUser(admin: AuthenticatedSession, userId: string, now = Date.now()): User {
    this.assertAdmin(admin, 'admin.user_approve', now)
    return this.manageUser(admin, userId, 'admin.user_approve', 'USER_APPROVED', now, (target) => {
      if (target.role !== 'member' || target.status !== 'pending') throw new AuthApiError('INVALID_USER_STATE', 409)
      return this.users.approve(target.id, admin.user.id, now)
    })
  }

  disableUser(admin: AuthenticatedSession, userId: string, now = Date.now()): User {
    this.assertAdmin(admin, 'admin.user_disable', now)
    if (userId === admin.user.id) {
      this.recordFailure('admin.user_disable', admin.user.id, 'CANNOT_DISABLE_SELF', now)
      throw new AuthApiError('CANNOT_DISABLE_SELF', 409)
    }
    return this.manageUser(admin, userId, 'admin.user_disable', 'USER_DISABLED', now, (target) => {
      if (target.role !== 'member' || target.status === 'disabled') throw new AuthApiError('INVALID_USER_STATE', 409)
      return this.users.disableAndRevokeSessions(target.id, now)
    })
  }

  async resetPassword(admin: AuthenticatedSession, userId: string, now = Date.now()): Promise<{ user: User; temporaryPassword: string }> {
    this.assertAdmin(admin, 'admin.user_reset_password', now)
    const generatedPassword = temporaryPassword()
    const passwordHash = await hashPassword(generatedPassword)
    const user = this.manageUser(admin, userId, 'admin.user_reset_password', 'PASSWORD_RESET', now, (target) => {
      return this.users.replacePasswordAndRevokeSessions(target.id, passwordHash, now, true)
    })
    return { user, temporaryPassword: generatedPassword }
  }

  private assertAdmin(authenticated: AuthenticatedSession, action: AuthAction, now: number): void {
    if (authenticated.user.role !== 'admin') {
      this.recordFailure(action, authenticated.user.id, 'FORBIDDEN', now)
      throw new AuthApiError('FORBIDDEN', 403)
    }
    if (authenticated.user.mustChangePassword) {
      this.recordFailure(action, authenticated.user.id, 'PASSWORD_CHANGE_REQUIRED', now)
      throw new AuthApiError('PASSWORD_CHANGE_REQUIRED', 403)
    }
  }

  private manageUser(
    admin: AuthenticatedSession,
    userId: string,
    action: AuthAction,
    successDiagnostic: string,
    now: number,
    mutate: (target: StoredUser) => StoredUser,
  ): User {
    try {
      return this.database.transaction(() => {
        let target: StoredUser
        try { target = this.users.read(userId) } catch { throw new AuthApiError('USER_NOT_FOUND', 404) }
        const updated = mutate(target)
        this.audit.record({ action, entityType: 'user', entityId: updated.id, result: 'success', diagnostic: successDiagnostic, now })
        return publicUser(updated)
      }).immediate()
    } catch (error) {
      const apiError = error instanceof AuthApiError ? error : new AuthApiError('AUTH_SERVICE_ERROR', 500)
      this.recordFailure(action, /^user-[0-9a-f-]{36}$/.test(userId) ? userId : admin.user.id, apiError.code, now)
      throw apiError
    }
  }
}

export function resolveTrustedClientIp(headers: { get(name: string): string | null }): string {
  const injected = headers.get(TRUSTED_CLIENT_IP_HEADER)?.trim()
  const resolved = safeIp(injected)
  return resolved !== 'unknown' ? resolved : '127.0.0.1'
}

export async function bootstrapAdministrator(database: Database, input: { username: unknown; password: unknown; now?: number }): Promise<User> {
  const now = input.now ?? Date.now()
  const users = new UserRepository(database)
  const audit = new AuditEventWriter(database)
  const username = normalizeUsername(input.username)
  const passwordHash = await hashPassword(input.password)
  try {
    return database.transaction(() => {
      if (users.countAdmins() !== 0) throw new AuthApiError('ADMIN_ALREADY_EXISTS', 409)
      const user = users.create({ username, passwordHash, role: 'admin', status: 'active', mustChangePassword: false, now })
      audit.record({ action: 'auth.bootstrap_admin', entityType: 'user', entityId: user.id, result: 'success', diagnostic: 'ADMIN_CREATED', now })
      return publicUser(user)
    }).immediate()
  } catch (error) {
    const apiError = error instanceof AuthApiError ? error : new AuthApiError('BOOTSTRAP_REJECTED', 409)
    audit.record({ action: 'auth.bootstrap_admin', entityType: 'request', entityId: 'bootstrap', result: 'failure', diagnostic: apiError.code, now })
    throw apiError
  }
}
