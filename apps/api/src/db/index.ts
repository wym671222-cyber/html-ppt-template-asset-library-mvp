import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'
import { LOCAL_DATABASE_PATH } from './paths.js'

mkdirSync(dirname(LOCAL_DATABASE_PATH), { recursive: true })
const sqlite = new Database(LOCAL_DATABASE_PATH)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
export { sqlite }
