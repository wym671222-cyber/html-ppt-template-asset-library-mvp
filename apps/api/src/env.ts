import { requireFixedDatabaseUrl } from './db/paths.js'

const port = Number(process.env.API_PORT ?? 3001)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('API_PORT must be an integer between 1 and 65535')
}

export function parseReadOnlyMode(value: string | undefined): boolean {
  if (value === undefined || value === '' || value === 'false') return false
  if (value === 'true') return true
  throw new Error('APP_READ_ONLY must be exactly true or false')
}

export const env = {
  port,
  databaseUrl: requireFixedDatabaseUrl(process.env.DATABASE_URL),
  appReadOnly: parseReadOnlyMode(process.env.APP_READ_ONLY),
} as const
