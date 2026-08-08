export type OwnerContext = Readonly<{
  id: 'local-owner'
  kind: 'local'
}>

const localOwner: OwnerContext = Object.freeze({ id: 'local-owner', kind: 'local' })

// Deliberately request-independent: no cookie, header, user record, or role.
export function getOwnerContext(): OwnerContext {
  return localOwner
}
