import { Algorithm, hash, verify } from '@node-rs/argon2'

export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128
export const ARGON2ID_POLICY = Object.freeze({
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  algorithm: Algorithm.Argon2id,
})

const ARGON2ID_HEADER = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/

export class PasswordValidationError extends Error {
  constructor() {
    super(`Password must contain ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`)
  }
}

function passwordLength(password: string): number {
  return [...password].length
}

export function assertPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string') throw new PasswordValidationError()
  const length = passwordLength(password)
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) throw new PasswordValidationError()
}

export function passwordHashMeetsPolicy(passwordHash: unknown): passwordHash is string {
  if (typeof passwordHash !== 'string' || passwordHash.length > 512) return false
  const match = ARGON2ID_HEADER.exec(passwordHash)
  if (!match) return false
  const [, memoryCost, timeCost, parallelism] = match.map(Number)
  return memoryCost >= ARGON2ID_POLICY.memoryCost
    && timeCost >= ARGON2ID_POLICY.timeCost
    && parallelism >= ARGON2ID_POLICY.parallelism
}

export async function hashPassword(password: unknown): Promise<string> {
  assertPassword(password)
  return hash(password, ARGON2ID_POLICY)
}

export async function verifyPassword(passwordHash: unknown, password: unknown): Promise<boolean> {
  if (!passwordHashMeetsPolicy(passwordHash)) return false
  try {
    assertPassword(password)
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}
