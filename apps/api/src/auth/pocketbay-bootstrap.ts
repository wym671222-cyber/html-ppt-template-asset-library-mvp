import type BetterSqlite3 from 'better-sqlite3'
import { AuthApiError, bootstrapAdministrator } from './service.js'

type BootstrapEnvironment = Record<string, string | undefined>
type BootstrapFunction = typeof bootstrapAdministrator

export async function bootstrapPocketBayAdministrator(
  database: BetterSqlite3.Database,
  variables: BootstrapEnvironment = process.env,
  create: BootstrapFunction = bootstrapAdministrator,
): Promise<boolean> {
  if (variables.POCKETBAY_RUNTIME !== 'true') return false
  const username = variables.POCKETBAY_ADMIN_USERNAME?.trim()
  const password = variables.POCKETBAY_ADMIN_PASSWORD
  if (!username && !password) return false
  if (!username || !password) throw new Error('PocketBay administrator bootstrap requires both username and password')
  try {
    await create(database, { username, password })
    return true
  } catch (error) {
    if (error instanceof AuthApiError && error.code === 'ADMIN_ALREADY_EXISTS') return false
    throw error
  } finally {
    delete variables.POCKETBAY_ADMIN_USERNAME
    delete variables.POCKETBAY_ADMIN_PASSWORD
  }
}
