import { requireFixedDatabaseUrl } from './db/paths.js'
import { isPocketBayOrigin, PRODUCTION_APP_ORIGIN, TEST_APP_ORIGINS } from './app.js'

const port = Number(process.env.API_PORT ?? 3001)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('API_PORT must be an integer between 1 and 65535')
}

export function parseReadOnlyMode(value: string | undefined): boolean {
  if (value === undefined || value === '' || value === 'false') return false
  if (value === 'true') return true
  throw new Error('APP_READ_ONLY must be exactly true or false')
}

export function parseAppOrigin(
  value: string | undefined,
  nodeEnvironment = process.env.NODE_ENV,
  pocketBayRuntime = process.env.POCKETBAY_RUNTIME,
  pocketBayPublicOrigin = process.env.POCKETBAY_PUBLIC_ORIGIN,
): string {
  if (nodeEnvironment === 'production') {
    if (pocketBayRuntime === 'true') {
      if (!pocketBayPublicOrigin || !isPocketBayOrigin(pocketBayPublicOrigin)) throw new Error('POCKETBAY_PUBLIC_ORIGIN must be one exact https://<project>.pocketbay.app Origin')
      if (value === undefined || value === pocketBayPublicOrigin) return pocketBayPublicOrigin
      throw new Error(`ORIGIN must be exactly ${pocketBayPublicOrigin} in PocketBay production`)
    }
    if (value === undefined || value === PRODUCTION_APP_ORIGIN) return PRODUCTION_APP_ORIGIN
    throw new Error(`ORIGIN must be exactly ${PRODUCTION_APP_ORIGIN} in production`)
  }
  const selected = value ?? TEST_APP_ORIGINS[0]
  if (!TEST_APP_ORIGINS.includes(selected)) throw new Error('ORIGIN must be an explicit loopback test Origin')
  return selected
}

export function parseRegistrationEnabled(value: string | undefined, pocketBayRuntime = process.env.POCKETBAY_RUNTIME): boolean {
  if (value === undefined || value === '') return pocketBayRuntime !== 'true'
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('REGISTRATION_ENABLED must be exactly true or false')
}

export const env = {
  port,
  databaseUrl: requireFixedDatabaseUrl(process.env.DATABASE_URL),
  appReadOnly: parseReadOnlyMode(process.env.APP_READ_ONLY),
  appOrigin: parseAppOrigin(process.env.ORIGIN),
  registrationEnabled: parseRegistrationEnabled(process.env.REGISTRATION_ENABLED),
} as const
