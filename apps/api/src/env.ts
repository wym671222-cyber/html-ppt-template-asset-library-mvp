import { requireFixedDatabaseUrl } from './db/paths.js'
import { PRODUCTION_APP_ORIGIN, TEST_APP_ORIGINS } from './app.js'

const port = Number(process.env.API_PORT ?? 3001)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('API_PORT must be an integer between 1 and 65535')
}

export function parseReadOnlyMode(value: string | undefined): boolean {
  if (value === undefined || value === '' || value === 'false') return false
  if (value === 'true') return true
  throw new Error('APP_READ_ONLY must be exactly true or false')
}

export function parseAppOrigin(value: string | undefined, nodeEnvironment = process.env.NODE_ENV): string {
  if (nodeEnvironment === 'production') {
    if (value === undefined || value === PRODUCTION_APP_ORIGIN) return PRODUCTION_APP_ORIGIN
    throw new Error(`ORIGIN must be exactly ${PRODUCTION_APP_ORIGIN} in production`)
  }
  const selected = value ?? TEST_APP_ORIGINS[0]
  if (!TEST_APP_ORIGINS.includes(selected)) throw new Error('ORIGIN must be an explicit loopback test Origin')
  return selected
}

export const env = {
  port,
  databaseUrl: requireFixedDatabaseUrl(process.env.DATABASE_URL),
  appReadOnly: parseReadOnlyMode(process.env.APP_READ_ONLY),
  appOrigin: parseAppOrigin(process.env.ORIGIN),
} as const
