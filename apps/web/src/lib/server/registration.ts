import { env } from '$env/dynamic/private'

export function registrationEnabled(): boolean {
  const value = env.REGISTRATION_ENABLED
  if (value === undefined || value === '') return env.POCKETBAY_RUNTIME !== 'true'
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('REGISTRATION_ENABLED must be exactly true or false')
}
