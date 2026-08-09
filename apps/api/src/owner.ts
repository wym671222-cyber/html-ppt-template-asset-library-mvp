export type OwnerContext = Readonly<{
  id: string
  kind: 'user'
}>

const USER_ID = /^user-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function isUserId(value: unknown): value is string {
  return typeof value === 'string' && USER_ID.test(value)
}

export function getOwnerContext(userId: string): OwnerContext {
  if (!isUserId(userId)) throw new Error('Authenticated user id is invalid')
  return Object.freeze({ id: userId, kind: 'user' })
}
