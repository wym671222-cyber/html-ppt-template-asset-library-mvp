import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, normalize, resolve } from 'node:path'

const dbDirectory = dirname(fileURLToPath(import.meta.url))
const developmentDataRoot = resolve(dbDirectory, '../../data')
const productionDataRoot = '/var/lib/html-ppt'

export function resolveDataRoot(value: string | undefined, nodeEnvironment = process.env.NODE_ENV): string {
  if (value === undefined || value === '') {
    if (nodeEnvironment === 'production') throw new Error(`ASSET_LIBRARY_DATA_ROOT must be exactly ${productionDataRoot} in production`)
    return developmentDataRoot
  }
  if (!isAbsolute(value) || normalize(value) !== value) throw new Error('ASSET_LIBRARY_DATA_ROOT must be a normalized absolute path')
  if (nodeEnvironment === 'production' && value !== productionDataRoot) {
    throw new Error(`ASSET_LIBRARY_DATA_ROOT must be exactly ${productionDataRoot} in production`)
  }
  return value
}

export const ASSET_LIBRARY_DATA_ROOT = resolveDataRoot(process.env.ASSET_LIBRARY_DATA_ROOT)
export const LOCAL_DATABASE_PATH = resolve(ASSET_LIBRARY_DATA_ROOT, 'asset-library.db')
export const LOCAL_DATABASE_URL = `file:${LOCAL_DATABASE_PATH}`
export const MIGRATIONS_DIRECTORY = resolve(dbDirectory, '../../drizzle')
export const LOCAL_CONTENT_STORE_PATH = resolve(ASSET_LIBRARY_DATA_ROOT, 'objects')
export const LOCAL_RECOVERY_BACKUP_PATH = resolve(ASSET_LIBRARY_DATA_ROOT, 'recovery-backups')
export const LOCAL_RECOVERY_DRILL_PATH = resolve(ASSET_LIBRARY_DATA_ROOT, 'recovery-drills')

export function requireFixedDatabaseUrl(url: string | undefined): string {
  if (url !== undefined && url !== LOCAL_DATABASE_URL) {
    throw new Error('DATABASE_URL is not supported: P02 uses the fixed local asset-library.db path')
  }
  return LOCAL_DATABASE_URL
}
