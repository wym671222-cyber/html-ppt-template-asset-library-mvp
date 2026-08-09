import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import type { AuthSession, User } from '@slide-maker/shared'
import { isSessionToken, parseSessionCookie, serializeSessionCookie } from './cookie.js'

type Database = BetterSqlite3.Database

export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1_000

type SessionRow = {
  id: string
  user_id: string
  token_hash: string
  expires_at: number
  created_at: number
  username: string
  role: User['role']
  status: User['status']
  must_change_password: number
  approved_at: number | null
  user_created_at: number
  user_updated_at: number
}

export type CreatedSession = Readonly<{
  session: AuthSession
  token: string
  cookie: string
}>

export type AuthenticatedSession = Readonly<{
  session: AuthSession
  user: User
}>

export class SessionError extends Error {
  constructor(message = 'Session request rejected') {
    super(message)
  }
}

function assertNow(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - SESSION_DURATION_MS) throw new SessionError()
}

export function hashSessionToken(token: unknown): string {
  if (!isSessionToken(token)) throw new SessionError('Session token is invalid')
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function sessionFromRow(row: SessionRow): AuthSession {
  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at, createdAt: row.created_at }
}

function userFromRow(row: SessionRow): User {
  return {
    id: row.user_id,
    username: row.username,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password === 1,
    approvedAt: row.approved_at,
    createdAt: row.user_created_at,
    updatedAt: row.user_updated_at,
  }
}

export class SessionRepository {
  constructor(private readonly database: Database) {}

  create(userId: string, now = Date.now()): CreatedSession {
    assertNow(now)
    const user = this.database.prepare('SELECT status FROM users WHERE id = ?').get(userId) as { status: User['status'] } | undefined
    if (!user || user.status !== 'active') throw new SessionError('Active user required')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(32).toString('base64url')
      const tokenHash = hashSessionToken(token)
      const session: AuthSession = {
        id: `session-${randomUUID()}`,
        userId,
        createdAt: now,
        expiresAt: now + SESSION_DURATION_MS,
      }
      try {
        this.database.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
          session.id, session.userId, tokenHash, session.expiresAt, session.createdAt,
        )
        return { session, token, cookie: serializeSessionCookie(token) }
      } catch {
        if (attempt === 2) throw new SessionError()
      }
    }
    throw new SessionError()
  }

  validateToken(token: unknown, now = Date.now()): AuthenticatedSession | null {
    assertNow(now)
    if (!isSessionToken(token)) return null
    const row = this.database.prepare(`
      SELECT session.id, session.user_id, session.token_hash, session.expires_at, session.created_at,
        user.username, user.role, user.status, user.must_change_password, user.approved_at,
        user.created_at AS user_created_at, user.updated_at AS user_updated_at
      FROM sessions session
      JOIN users user ON user.id = session.user_id
      WHERE session.token_hash = ? AND session.expires_at > ? AND user.status = 'active'
    `).get(hashSessionToken(token), now) as SessionRow | undefined
    return row ? { session: sessionFromRow(row), user: userFromRow(row) } : null
  }

  validateCookie(header: string | null | undefined, now = Date.now()): AuthenticatedSession | null {
    const token = parseSessionCookie(header)
    return token ? this.validateToken(token, now) : null
  }

  revokeSession(sessionId: string): boolean {
    if (!/^session-[0-9a-f-]{36}$/.test(sessionId)) return false
    return this.database.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId).changes === 1
  }

  revokeUserSessions(userId: string): number {
    if (!/^user-[0-9a-f-]{36}$/.test(userId)) return 0
    return this.database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes
  }
}
