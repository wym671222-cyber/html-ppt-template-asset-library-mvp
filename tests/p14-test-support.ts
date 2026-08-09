import type { AuthSession, User, UserRole } from '@slide-maker/shared'
import type { AuthApplicationService } from '../apps/api/src/auth/service.js'
import { getOwnerContext } from '../apps/api/src/owner.js'

export const TEST_USER_ID = 'user-00000000-0000-4000-8000-000000000001'
export const TEST_MEMBER_ID = 'user-00000000-0000-4000-8000-000000000002'
const TEST_PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$fixture$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

type TestDatabase = {
  prepare(sql: string): { run(...parameters: unknown[]): unknown }
}

export function seedTestUser(database: TestDatabase, id = TEST_USER_ID, role: UserRole = 'admin', mustChangePassword = false): User {
  const now = 1_786_636_800_000
  const username = role === 'admin' ? `admin${id.slice(-1)}` : `member${id.slice(-1)}`
  database.prepare(`INSERT INTO users (id, username, password_hash, role, status, must_change_password, approved_by, approved_at, password_changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?, ?)`)
    .run(id, username, TEST_PASSWORD_HASH, role, mustChangePassword ? 1 : 0, now, now, now)
  return { id, username, role, status: 'active', mustChangePassword, approvedAt: null, createdAt: now, updatedAt: now }
}

export function testOwner(userId = TEST_USER_ID) {
  return getOwnerContext(userId)
}

export function createTrustedTestAuth(user: User): AuthApplicationService {
  const session: AuthSession = { id: `session-${user.id.slice(5)}`, userId: user.id, createdAt: user.createdAt, expiresAt: user.createdAt + 604_800_000 }
  return {
    authenticate: () => ({ user, session }),
    recordFailure: () => undefined,
  } as unknown as AuthApplicationService
}
