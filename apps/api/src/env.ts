import { requireFixedDatabaseUrl } from './db/paths.js'

const port = Number(process.env.API_PORT ?? 3001)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('API_PORT must be an integer between 1 and 65535')
}

export const env = {
  port,
  databaseUrl: requireFixedDatabaseUrl(process.env.DATABASE_URL),
} as const
