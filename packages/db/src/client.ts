import { DatabaseSync } from 'node:sqlite'
import { drizzle as drizzleProxy, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { loadEnv, getLogger } from '@hub/shared'
import * as schema from './schema.js'

let cached: SqliteRemoteDatabase<typeof schema> | undefined
let cachedRaw: DatabaseSync | undefined

/**
 * Drizzle client backed by Node's built-in `node:sqlite`.
 *
 * Why node:sqlite instead of better-sqlite3?
 *   - better-sqlite3 and @libsql/client do NOT publish prebuilt binaries for
 *     win32-arm64 as of April 2026, and we don't want a VS Build Tools
 *     dependency for a one-command setup.
 *   - node:sqlite ships with Node 22.5+/24 and Just Works on every arch.
 *   - Drizzle's sqlite-proxy driver lets us adapt any sync SQLite driver.
 *
 * Tradeoff: node:sqlite is `experimental` in Node 24 (warning on first use).
 * Planned migration: swap to `drizzle-orm/node-sqlite` once Drizzle ships one.
 */
export function getDb(): SqliteRemoteDatabase<typeof schema> {
  if (cached) return cached
  const env = loadEnv()
  mkdirSync(dirname(env.HUB_DB_PATH), { recursive: true })
  const sqlite = new DatabaseSync(env.HUB_DB_PATH)
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA synchronous = NORMAL')
  sqlite.exec('PRAGMA busy_timeout = 5000')
  sqlite.exec('PRAGMA foreign_keys = ON')
  cachedRaw = sqlite

  cached = drizzleProxy(
    async (sql, params, method) => {
      const stmt = sqlite.prepare(sql)
      const boundParams = params as never[]
      if (method === 'run') {
        stmt.run(...boundParams)
        return { rows: [] }
      }
      // sqlite-proxy expects columnar tuples (arrays of values) not row objects.
      const rows = stmt.all(...boundParams) as Array<Record<string, unknown>>
      const values = rows.map((r) => Object.values(r))
      if (method === 'get') {
        // For get(): undefined rows signals "no row" to drizzle's mapGetResult.
        // An empty array [] would be mapped to an empty row object (truthy) and
        // cause phantom duplicates.
        return { rows: values.length > 0 ? (values[0] as unknown[]) : (undefined as unknown as unknown[]) }
      }
      return { rows: values }
    },
    { schema },
  )

  getLogger('db').info({ path: env.HUB_DB_PATH }, 'sqlite opened (node:sqlite)')
  return cached
}

export function getRawDb(): DatabaseSync {
  if (!cachedRaw) getDb()
  return cachedRaw!
}

/** Test/cleanup helper. */
export function closeDb(): void {
  cachedRaw?.close()
  cached = undefined
  cachedRaw = undefined
}
