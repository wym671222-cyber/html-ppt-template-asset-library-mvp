import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, PRODUCTION_APP_ORIGIN } from '../apps/api/src/app.js'
import {
  AuthApiError,
  AuthApplicationService,
  bootstrapAdministrator,
  resolveTrustedClientIp,
  TRUSTED_CLIENT_IP_HEADER,
} from '../apps/api/src/auth/service.js'
import { SESSION_COOKIE_NAME } from '../apps/api/src/auth/cookie.js'
import { verifyPassword } from '../apps/api/src/auth/password.js'
import { SessionRepository } from '../apps/api/src/auth/sessions.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { parseAppOrigin } from '../apps/api/src/env.js'
import { runBootstrap } from '../apps/api/src/auth/bootstrap-admin.js'

type RunResult = { changes: number }
type Statement = {
  all(...parameters: unknown[]): unknown[]
  get(...parameters: unknown[]): unknown
  run(...parameters: unknown[]): RunResult
}
type SQLite = {
  pragma(statement: string, options?: { simple: true }): unknown
  prepare(statement: string): Statement
  close(): void
}

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url))
const Database = apiRequire('better-sqlite3') as new (path: string) => SQLite
const temporaryRoots: string[] = []
const ORIGIN = 'http://127.0.0.1:5173'
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' }

function state(label: string): { path: string; database: SQLite; service: AuthApplicationService; app: ReturnType<typeof createApp> } {
  const root = mkdtempSync(join(tmpdir(), `asset-library-p13-${label}-`))
  temporaryRoots.push(root)
  const path = join(root, 'asset-library.db')
  migrateDatabase(path)
  const database = new Database(path)
  database.pragma('foreign_keys = ON')
  const service = new AuthApplicationService(database as never)
  return { path, database, service, app: createApp({ auth: service }) }
}

function post(app: ReturnType<typeof createApp>, path: string, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return app.request(`http://127.0.0.1:3001${path}`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  })
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('Missing Set-Cookie')
  return setCookie.split(';', 1)[0]
}

async function register(app: ReturnType<typeof createApp>, username: string, password = 'member-pass-1'): Promise<{ id: string }> {
  const response = await post(app, '/api/auth/register', { username, password })
  expect(response.status).toBe(201)
  return (await response.json() as { user: { id: string } }).user
}

async function login(app: ReturnType<typeof createApp>, username: string, password: string): Promise<Response> {
  return post(app, '/api/auth/login', { username, password })
}

async function adminSession(database: SQLite, app: ReturnType<typeof createApp>): Promise<{ id: string; cookie: string }> {
  const user = await bootstrapAdministrator(database as never, { username: 'root_admin', password: 'admin-pass-1', now: 1 })
  const response = await login(app, user.username, 'admin-pass-1')
  expect(response.status).toBe(200)
  return { id: user.id, cookie: cookieFrom(response) }
}

function businessState(database: SQLite): string {
  return JSON.stringify({
    users: database.prepare('SELECT id, username, password_hash, role, status, must_change_password, approved_by, approved_at, password_changed_at, created_at, updated_at FROM users ORDER BY id').all(),
    sessions: database.prepare('SELECT id, user_id, token_hash, expires_at, created_at FROM sessions ORDER BY id').all(),
  })
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('P13 registration, login and exact Origin contract', () => {
  it('creates only a pending username account, reveals state only after a correct password and keeps failures business-read-only', async () => {
    const current = state('register-login')
    try {
      const missingOrigin = await current.app.request('http://127.0.0.1:3001/api/auth/register', { method: 'POST', body: '{}' })
      expect(missingOrigin.status).toBe(403)
      expect((await post(current.app, '/api/auth/register', { username: 'alice_user', password: 'member-pass-1' }, { origin: 'https://attacker.example' })).status).toBe(403)

      const registered = await post(current.app, '/api/auth/register', { username: '  Alice_User  ', password: 'member-pass-1' })
      expect(registered.status).toBe(201)
      const registrationJson = await registered.json() as { user: Record<string, unknown> }
      expect(registrationJson.user).toMatchObject({ username: 'alice_user', status: 'pending', role: 'member', mustChangePassword: false })
      expect(registrationJson.user).not.toHaveProperty('email')
      expect(registrationJson.user).not.toHaveProperty('passwordHash')
      expect(registrationJson).not.toHaveProperty('session')
      expect((current.database.prepare('SELECT count(*) AS count FROM sessions').get() as { count: number }).count).toBe(0)

      const beforeWrongPassword = businessState(current.database)
      const wrong = await login(current.app, 'alice_user', 'wrong-pass-1')
      expect(wrong.status).toBe(401)
      expect(await wrong.json()).toEqual({ error: 'INVALID_CREDENTIALS' })
      expect(businessState(current.database)).toBe(beforeWrongPassword)

      const pending = await login(current.app, 'alice_user', 'member-pass-1')
      expect(pending.status).toBe(403)
      expect(await pending.json()).toEqual({ error: 'ACCOUNT_PENDING' })
      expect(businessState(current.database)).toBe(beforeWrongPassword)

      const unknown = await login(current.app, 'not_a_user', 'wrong-pass-1')
      expect(unknown.status).toBe(401)
      expect(await unknown.json()).toEqual({ error: 'INVALID_CREDENTIALS' })
      expect(businessState(current.database)).toBe(beforeWrongPassword)
    } finally { current.database.close() }
  })

  it('locks production Origin to the approved host and test Origin to explicit loopback values', () => {
    expect(parseAppOrigin(undefined, 'production')).toBe(PRODUCTION_APP_ORIGIN)
    expect(parseAppOrigin(PRODUCTION_APP_ORIGIN, 'production')).toBe(PRODUCTION_APP_ORIGIN)
    expect(() => parseAppOrigin('https://attacker.example', 'production')).toThrow(/exactly/)
    expect(parseAppOrigin(ORIGIN, 'test')).toBe(ORIGIN)
    expect(() => parseAppOrigin(PRODUCTION_APP_ORIGIN, 'test')).toThrow(/loopback/)
  })

  it('ignores client-controlled proxy headers and accepts only the internal BFF hop contract', () => {
    expect(resolveTrustedClientIp(new Headers({
      'x-forwarded-for': '203.0.113.1',
      'x-real-ip': '203.0.113.2',
      forwarded: 'for=203.0.113.3',
    }))).toBe('127.0.0.1')
    expect(resolveTrustedClientIp(new Headers({ [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.9' }))).toBe('203.0.113.9')
    expect(resolveTrustedClientIp(new Headers({ [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.9, 198.51.100.1' }))).toBe('127.0.0.1')
    expect(resolveTrustedClientIp(new Headers({ [TRUSTED_CLIENT_IP_HEADER]: 'attacker.example' }))).toBe('127.0.0.1')
  })
})

describe('P13 approval, session and account state machine', () => {
  it('lets the unique administrator list and approve pending users, then logs out one fixed session', async () => {
    const current = state('approve')
    try {
      const admin = await adminSession(current.database, current.app)
      const member = await register(current.app, 'approved_user')
      const list = await current.app.request('http://127.0.0.1:3001/api/admin/users?status=pending', { headers: { cookie: admin.cookie } })
      expect(list.status).toBe(200)
      expect(await list.json()).toMatchObject({ users: [{ id: member.id, username: 'approved_user', status: 'pending' }] })

      const approved = await post(current.app, `/api/admin/users/${member.id}/approve`, {}, { cookie: admin.cookie })
      expect(approved.status).toBe(200)
      expect(await approved.json()).toMatchObject({ user: { id: member.id, status: 'active', approvedAt: expect.any(Number) } })
      expect((await post(current.app, `/api/admin/users/${member.id}/approve`, {}, { cookie: admin.cookie })).status).toBe(409)

      const memberLogin = await login(current.app, 'approved_user', 'member-pass-1')
      expect(memberLogin.status).toBe(200)
      const memberCookie = cookieFrom(memberLogin)
      expect(memberLogin.headers.get('set-cookie')).toMatch(/^__Host-ppt_session=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; HttpOnly; Secure; SameSite=Lax$/)
      expect(memberLogin.headers.get('set-cookie')).not.toMatch(/Domain=/i)
      const session = await current.app.request('http://127.0.0.1:3001/api/auth/session', { headers: { cookie: memberCookie } })
      expect(session.status).toBe(200)
      expect(JSON.stringify(await session.json())).not.toMatch(/email|passwordHash|token/i)
      expect((await current.app.request('http://127.0.0.1:3001/api/admin/users', { headers: { cookie: memberCookie } })).status).toBe(403)

      const logout = await post(current.app, '/api/auth/logout', {}, { cookie: memberCookie })
      expect(logout.status).toBe(204)
      expect(logout.headers.get('set-cookie')).toBe(`${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`)
      expect((await current.app.request('http://127.0.0.1:3001/api/auth/session', { headers: { cookie: memberCookie } })).status).toBe(401)
      const staleLogout = await post(current.app, '/api/auth/logout', {}, { cookie: memberCookie })
      expect(staleLogout.status).toBe(204)
      expect(staleLogout.headers.get('set-cookie')).toContain('Max-Age=0')
    } finally { current.database.close() }
  })

  it('prevents self-disable and a second administrator, while disable revokes every member session', async () => {
    const current = state('disable')
    try {
      const admin = await adminSession(current.database, current.app)
      await expect(bootstrapAdministrator(current.database as never, { username: 'second_admin', password: 'admin-pass-2' })).rejects.toMatchObject<AuthApiError>({ code: 'ADMIN_ALREADY_EXISTS' })
      expect((await post(current.app, `/api/admin/users/${admin.id}/disable`, {}, { cookie: admin.cookie })).status).toBe(409)
      expect((current.database.prepare('SELECT status FROM users WHERE id = ?').get(admin.id) as { status: string }).status).toBe('active')

      const member = await register(current.app, 'disable_user')
      expect((await post(current.app, `/api/admin/users/${member.id}/approve`, {}, { cookie: admin.cookie })).status).toBe(200)
      const sessionOne = await login(current.app, 'disable_user', 'member-pass-1')
      const sessionTwo = await login(current.app, 'disable_user', 'member-pass-1')
      expect(sessionOne.status).toBe(200)
      expect(sessionTwo.status).toBe(200)
      expect((await post(current.app, `/api/admin/users/${member.id}/disable`, {}, { cookie: admin.cookie })).status).toBe(200)
      expect((current.database.prepare('SELECT count(*) AS count FROM sessions WHERE user_id = ?').get(member.id) as { count: number }).count).toBe(0)
      expect((await login(current.app, 'disable_user', 'wrong-pass-1')).status).toBe(401)
      const disabled = await login(current.app, 'disable_user', 'member-pass-1')
      expect(disabled.status).toBe(403)
      expect(await disabled.json()).toEqual({ error: 'ACCOUNT_DISABLED' })
    } finally { current.database.close() }
  })
})

describe('P13 password reset/change, audit safety and persistent throttles', () => {
  it('shows a temporary password once, forces change, revokes all sessions and never persists the secret in audit or diagnostics', async () => {
    const current = state('passwords')
    try {
      const admin = await adminSession(current.database, current.app)
      const member = await register(current.app, 'password_user')
      await post(current.app, `/api/admin/users/${member.id}/approve`, {}, { cookie: admin.cookie })
      await login(current.app, 'password_user', 'member-pass-1')
      await login(current.app, 'password_user', 'member-pass-1')

      const reset = await post(current.app, `/api/admin/users/${member.id}/reset-password`, {}, { cookie: admin.cookie })
      expect(reset.status).toBe(200)
      const resetJson = await reset.json() as { temporaryPassword: string; user: { mustChangePassword: boolean } }
      expect(resetJson.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/)
      expect(resetJson.user.mustChangePassword).toBe(true)
      expect((current.database.prepare('SELECT count(*) AS count FROM sessions WHERE user_id = ?').get(member.id) as { count: number }).count).toBe(0)
      expect((await login(current.app, 'password_user', 'member-pass-1')).status).toBe(401)

      const temporaryLogin = await login(current.app, 'password_user', resetJson.temporaryPassword)
      expect(temporaryLogin.status).toBe(200)
      expect((await temporaryLogin.json() as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(true)
      const temporaryCookie = cookieFrom(temporaryLogin)
      new SessionRepository(current.database as never).create(member.id)
      const beforeWrongChange = businessState(current.database)
      expect((await post(current.app, '/api/auth/change-password', { currentPassword: 'wrong-pass-1', newPassword: 'new-member-pass-1' }, { cookie: temporaryCookie })).status).toBe(401)
      expect(businessState(current.database)).toBe(beforeWrongChange)

      const changed = await post(current.app, '/api/auth/change-password', { currentPassword: resetJson.temporaryPassword, newPassword: 'new-member-pass-1' }, { cookie: temporaryCookie })
      expect(changed.status).toBe(204)
      expect(changed.headers.get('set-cookie')).toContain('Max-Age=0')
      expect((current.database.prepare('SELECT count(*) AS count FROM sessions WHERE user_id = ?').get(member.id) as { count: number }).count).toBe(0)
      expect((current.database.prepare('SELECT must_change_password FROM users WHERE id = ?').get(member.id) as { must_change_password: number }).must_change_password).toBe(0)
      const stored = current.database.prepare('SELECT password_hash FROM users WHERE id = ?').get(member.id) as { password_hash: string }
      expect(await verifyPassword(stored.password_hash, 'new-member-pass-1')).toBe(true)
      expect((await login(current.app, 'password_user', 'new-member-pass-1')).status).toBe(200)

      const audit = JSON.stringify(current.database.prepare('SELECT action, entity_type, entity_id, result, diagnostic FROM audit_events ORDER BY created_at, id').all())
      expect(audit).not.toContain(resetJson.temporaryPassword)
      expect(audit).not.toContain('member-pass-1')
      expect(audit).not.toContain(temporaryCookie)
      expect(audit).toContain('admin.user_reset_password')
      expect(audit).toContain('auth.change_password')
    } finally { current.database.close() }
  })

  it('blocks every admin API until a reset administrator changes the temporary password', async () => {
    const current = state('admin-must-change')
    try {
      const admin = await adminSession(current.database, current.app)
      const member = await register(current.app, 'admin_gate_member')
      const reset = await post(current.app, `/api/admin/users/${admin.id}/reset-password`, {}, { cookie: admin.cookie })
      expect(reset.status).toBe(200)
      const resetJson = await reset.json() as { temporaryPassword: string; user: { mustChangePassword: boolean } }
      expect(resetJson.user.mustChangePassword).toBe(true)

      const temporaryLogin = await login(current.app, 'root_admin', resetJson.temporaryPassword)
      expect(temporaryLogin.status).toBe(200)
      const temporaryCookie = cookieFrom(temporaryLogin)
      expect((await current.app.request('http://127.0.0.1:3001/api/auth/session', { headers: { cookie: temporaryCookie } })).status).toBe(200)

      const blockedRequests = [
        current.app.request('http://127.0.0.1:3001/api/admin/users', { headers: { cookie: temporaryCookie } }),
        post(current.app, `/api/admin/users/${member.id}/approve`, {}, { cookie: temporaryCookie }),
        post(current.app, `/api/admin/users/${member.id}/disable`, {}, { cookie: temporaryCookie }),
        post(current.app, `/api/admin/users/${member.id}/reset-password`, {}, { cookie: temporaryCookie }),
      ]
      for (const response of await Promise.all(blockedRequests)) {
        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error: 'PASSWORD_CHANGE_REQUIRED' })
      }
      expect((current.database.prepare('SELECT status FROM users WHERE id = ?').get(member.id) as { status: string }).status).toBe('pending')

      const logoutLogin = await login(current.app, 'root_admin', resetJson.temporaryPassword)
      expect(logoutLogin.status).toBe(200)
      expect((await post(current.app, '/api/auth/logout', {}, { cookie: cookieFrom(logoutLogin) })).status).toBe(204)

      const changed = await post(current.app, '/api/auth/change-password', {
        currentPassword: resetJson.temporaryPassword,
        newPassword: 'restored-admin-pass-1',
      }, { cookie: temporaryCookie })
      expect(changed.status).toBe(204)
      expect(changed.headers.get('set-cookie')).toContain('Max-Age=0')
      expect((current.database.prepare('SELECT must_change_password FROM users WHERE id = ?').get(admin.id) as { must_change_password: number }).must_change_password).toBe(0)
      expect((current.database.prepare('SELECT count(*) AS count FROM sessions WHERE user_id = ?').get(admin.id) as { count: number }).count).toBe(0)
      expect((await current.app.request('http://127.0.0.1:3001/api/auth/session', { headers: { cookie: temporaryCookie } })).status).toBe(401)

      const restoredLogin = await login(current.app, 'root_admin', 'restored-admin-pass-1')
      expect(restoredLogin.status).toBe(200)
      const restoredCookie = cookieFrom(restoredLogin)
      expect((await current.app.request('http://127.0.0.1:3001/api/admin/users', { headers: { cookie: restoredCookie } })).status).toBe(200)
      expect((await post(current.app, `/api/admin/users/${member.id}/approve`, {}, { cookie: restoredCookie })).status).toBe(200)
    } finally { current.database.close() }
  })

  it('persists 3/IP/hour registration blocking across restart and stores only hashed throttle keys', async () => {
    const current = state('throttle')
    const ipHeaders = { [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.9' }
    try {
      for (let index = 0; index < 3; index += 1) {
        expect((await post(current.app, '/api/auth/register', { username: `rate_user_${index}`, password: 'member-pass-1' }, ipHeaders)).status).toBe(201)
      }
      const blocked = await post(current.app, '/api/auth/register', { username: 'rate_user_3', password: 'member-pass-1' }, ipHeaders)
      expect(blocked.status).toBe(429)
      expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/)
      const rows = current.database.prepare('SELECT key_hash FROM auth_throttle').all() as Array<{ key_hash: string }>
      expect(rows).toHaveLength(1)
      expect(rows[0].key_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(rows)).not.toContain('203.0.113.9')
      current.database.close()

      const reopened = new Database(current.path)
      reopened.pragma('foreign_keys = ON')
      try {
        const app = createApp({ auth: new AuthApplicationService(reopened as never) })
        expect((await post(app, '/api/auth/register', { username: 'rate_user_4', password: 'member-pass-1' }, ipHeaders)).status).toBe(429)
      } finally { reopened.close() }
    } catch (error) {
      try { current.database.close() } catch {}
      throw error
    }
  })

  it('uses simultaneous IP+username login buckets and keeps the offline bootstrap CLI interactive-only', async () => {
    const current = state('login-throttle')
    try {
      await bootstrapAdministrator(current.database as never, { username: 'login_admin', password: 'admin-pass-1' })
      await expect(runBootstrap(current.database as never, ['noninteractive_admin'])).rejects.toThrow(/interactive terminal/)
      for (let index = 0; index < 5; index += 1) expect((await login(current.app, 'login_admin', 'wrong-pass-1')).status).toBe(401)
      current.database.close()

      const reopened = new Database(current.path)
      reopened.pragma('foreign_keys = ON')
      try {
        const restartedApp = createApp({ auth: new AuthApplicationService(reopened as never) })
        expect((await login(restartedApp, 'login_admin', 'wrong-pass-1')).status).toBe(429)
        const throttleCount = (reopened.prepare('SELECT count(*) AS count FROM auth_throttle').get() as { count: number }).count
        expect(throttleCount).toBe(2)
      } finally { reopened.close() }

      const source = readFileSync(join(process.cwd(), 'apps/api/src/auth/bootstrap-admin.ts'), 'utf8')
      expect(source).toContain('output.muted = true')
      expect(source).toContain('interactive terminal')
      expect(source).not.toContain('--password')
      expect(source).not.toMatch(/console\.log/)
    } finally { try { current.database.close() } catch {} }
  })

  it('includes the bootstrap CLI in the standard API TypeScript build graph and emits its runnable module', () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-library-p13-bootstrap-build-'))
    temporaryRoots.push(root)
    const output = join(root, 'dist')
    const apiPackage = JSON.parse(readFileSync(join(process.cwd(), 'apps/api/package.json'), 'utf8')) as { scripts: Record<string, string> }
    const apiTsconfig = JSON.parse(readFileSync(join(process.cwd(), 'apps/api/tsconfig.json'), 'utf8')) as { include: string[] }
    expect(apiPackage.scripts.build).toBe('tsc')
    expect(apiTsconfig.include).toContain('src/auth/bootstrap-admin.ts')
    execFileSync(join(process.cwd(), 'node_modules/.bin/tsc'), [
      '-p',
      'apps/api/tsconfig.json',
      '--outDir',
      output,
    ], { cwd: process.cwd(), stdio: 'pipe' })
    expect(existsSync(join(output, 'auth/bootstrap-admin.js'))).toBe(true)
  }, 15_000)
})
