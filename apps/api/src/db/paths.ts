import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const dbDirectory = dirname(fileURLToPath(import.meta.url))

export const LOCAL_DATABASE_PATH = resolve(dbDirectory, '../../data/asset-library.db')
export const LOCAL_DATABASE_URL = `file:${LOCAL_DATABASE_PATH}`
export const MIGRATIONS_DIRECTORY = resolve(dbDirectory, '../../drizzle')
export const LOCAL_CONTENT_STORE_PATH = resolve(dbDirectory, '../../data/objects')

export function requireFixedDatabaseUrl(url: string | undefined): string {
  if (url !== undefined && url !== LOCAL_DATABASE_URL) {
    throw new Error('DATABASE_URL is not supported: P02 uses the fixed local asset-library.db path')
  }
  return LOCAL_DATABASE_URL
}
