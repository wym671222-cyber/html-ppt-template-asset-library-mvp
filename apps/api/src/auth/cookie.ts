export const SESSION_COOKIE_NAME = '__Host-ppt_session'
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const COOKIE_VALUE = /^[\x21-\x3A\x3C-\x7E]*$/
const MAX_COOKIE_HEADER_BYTES = 4_096

export function isSessionToken(value: unknown): value is string {
  if (typeof value !== 'string' || !SESSION_TOKEN.test(value)) return false
  const decoded = Buffer.from(value, 'base64url')
  return decoded.byteLength === 32 && decoded.toString('base64url') === value
}

export function serializeSessionCookie(token: unknown): string {
  if (!isSessionToken(token)) throw new Error('Session token is invalid')
  return `${SESSION_COOKIE_NAME}=${token}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`
}

export function serializeClearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`
}

export function parseSessionCookie(header: string | null | undefined): string | null {
  if (header === null || header === undefined || header.length === 0 || Buffer.byteLength(header, 'utf8') > MAX_COOKIE_HEADER_BYTES) return null
  const seen = new Set<string>()
  let sessionToken: string | null = null
  for (const rawPart of header.split(';')) {
    const part = rawPart.trim()
    const separator = part.indexOf('=')
    if (!part || separator < 1) return null
    const name = part.slice(0, separator)
    const value = part.slice(separator + 1)
    if (!COOKIE_NAME.test(name) || !COOKIE_VALUE.test(value) || seen.has(name)) return null
    seen.add(name)
    if (name === SESSION_COOKIE_NAME) {
      if (!isSessionToken(value)) return null
      sessionToken = value
    }
  }
  return sessionToken
}
