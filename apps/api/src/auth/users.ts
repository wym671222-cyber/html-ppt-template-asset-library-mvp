import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import type { User, UserRole, UserStatus } from '@slide-maker/shared'
import { passwordHashMeetsPolicy } from './password.js'

type Database = BetterSqlite3.Database

const USERNAME = /^[a-z][a-z0-9._-]{2,31}$/
const USER_ID = /^user-[0-9a-f-]{36}$/

export type StoredUser = User & Readonly<{
  passwordHash: string
  approvedBy: string | null
  passwordChangedAt: number
}>

type UserRow = {
  id: string
  username: string
  password_hash: string
  role: UserRole
  status: UserStatus
  must_change_password: number
  approved_by: string | null
  approved_at: number | null
  password_changed_at: number
  created_at: number
  updated_at: number
}

export class AuthDataError extends Error {
  constructor(message = 'Auth data constraint rejected') {
    super(message)
  }
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new AuthDataError('Auth timestamp is invalid')
}

export function normalizeUsername(value: unknown): string {
  if (typeof value !== 'string') throw new AuthDataError('Username is invalid')
  const username = value.trim().toLowerCase()
  if (!USERNAME.test(username)) throw new AuthDataError('Username is invalid')
  return username
}

function toStoredUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password === 1,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    passwordHash: row.password_hash,
    approvedBy: row.approved_by,
    passwordChangedAt: row.password_changed_at,
  }
}

export function publicUser(user: StoredUser): User {
  const { passwordHash: _passwordHash, approvedBy: _approvedBy, passwordChangedAt: _passwordChangedAt, ...safe } = user
  return safe
}

export class UserRepository {
  constructor(private readonly database: Database) {}

  create(input: {
    username: unknown
    passwordHash: unknown
    role?: UserRole
    status?: UserStatus
    mustChangePassword?: boolean
    approvedBy?: string | null
    approvedAt?: number | null
    now?: number
  }): StoredUser {
    const username = normalizeUsername(input.username)
    if (!passwordHashMeetsPolicy(input.passwordHash)) throw new AuthDataError('Password hash policy is invalid')
    const role = input.role ?? 'member'
    const status = input.status ?? 'pending'
    if (role !== 'admin' && role !== 'member') throw new AuthDataError()
    if (status !== 'pending' && status !== 'active' && status !== 'disabled') throw new AuthDataError()
    const approvedBy = input.approvedBy ?? null
    const approvedAt = input.approvedAt ?? null
    if ((approvedBy === null) !== (approvedAt === null) || (approvedBy !== null && !USER_ID.test(approvedBy))) throw new AuthDataError('Approval metadata is invalid')
    const now = input.now ?? Date.now()
    assertTimestamp(now)
    const id = `user-${randomUUID()}`
    try {
      this.database.prepare(`
        INSERT INTO users (
          id, username, password_hash, role, status, must_change_password,
          approved_by, approved_at, password_changed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, username, input.passwordHash, role, status, input.mustChangePassword ? 1 : 0, approvedBy, approvedAt, now, now, now)
    } catch {
      throw new AuthDataError()
    }
    return this.read(id)
  }

  read(id: string): StoredUser {
    if (!USER_ID.test(id)) throw new AuthDataError('User id is invalid')
    const row = this.database.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
    if (!row) throw new AuthDataError('User not found')
    return toStoredUser(row)
  }

  findByUsername(value: unknown): StoredUser | null {
    const username = normalizeUsername(value)
    const row = this.database.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as UserRow | undefined
    return row ? toStoredUser(row) : null
  }

  replacePasswordAndRevokeSessions(id: string, passwordHash: unknown, now = Date.now()): void {
    if (!USER_ID.test(id) || !passwordHashMeetsPolicy(passwordHash)) throw new AuthDataError()
    assertTimestamp(now)
    try {
      this.database.transaction(() => {
        const changed = this.database.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, now, id).changes
        if (changed !== 1) throw new AuthDataError('User not found')
        this.database.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
      })()
    } catch (error) {
      if (error instanceof AuthDataError) throw error
      throw new AuthDataError()
    }
  }

  disableAndRevokeSessions(id: string, now = Date.now()): void {
    if (!USER_ID.test(id)) throw new AuthDataError('User id is invalid')
    assertTimestamp(now)
    try {
      this.database.transaction(() => {
        const changed = this.database.prepare("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?").run(now, id).changes
        if (changed !== 1) throw new AuthDataError('User not found')
        this.database.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
      })()
    } catch (error) {
      if (error instanceof AuthDataError) throw error
      throw new AuthDataError()
    }
  }
}
