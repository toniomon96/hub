import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { loadEnv, getLogger } from '@hub/shared'
import * as schema from './schema.js'

let cached: BetterSQLite3Database<typeof schema> | undefined
let cachedRaw: Database.Database | undefined

/**
 * Get the singleton Drizzle client. Creates the file + directory on first call.
 * WAL mode + reasonable busy timeout for concurrent webhook + cron writes.
 */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (cached) return cached
  const env = loadEnv()
  mkdirSync(dirname(env.HUB_DB_PATH), { recursive: true })
  const sqlite = new Database(env.HUB_DB_PATH)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('foreign_keys = ON')
  cachedRaw = sqlite
  cached = drizzle(sqlite, { schema })
  getLogger('db').info({ path: env.HUB_DB_PATH }, 'sqlite opened')
  return cached
}

export function getRawDb(): Database.Database {
  if (!cachedRaw) getDb()
  return cachedRaw!
}

/** Test/cleanup helper. */
export function closeDb(): void {
  cachedRaw?.close()
  cached = undefined
  cachedRaw = undefined
}
