import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { getRawDb } from './client.js'
import { getLogger } from '@hub/shared'

const log = getLogger('db-migrate')

/**
 * Resolve the migrations folder regardless of whether we're running from src/
 * (tsx dev) or dist/ (compiled). The folder lives at packages/db/migrations/.
 */
function resolveMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const tries = [
    resolve(here, '..', 'migrations'),
    resolve(here, '..', '..', 'migrations'),
  ]
  for (const t of tries) if (existsSync(t)) return t
  throw new Error(`Could not locate @hub/db migrations folder (tried ${tries.join(', ')})`)
}

/**
 * Apply all pending migrations. Idempotent.
 *
 * Custom runner (not drizzle-orm/sqlite-proxy/migrator) because the proxy
 * migrator is async-callback oriented and we want a simple sync flow for
 * node:sqlite. We track applied migration hashes in a lightweight journal
 * table, matching drizzle-kit's filesystem ordering (lexicographic).
 */
export function migrate(): void {
  const db = getRawDb()
  const folder = resolveMigrationsFolder()
  log.info({ folder }, 'applying migrations')

  db.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    );
  `)

  const applied = new Set(
    (db.prepare('SELECT tag FROM __drizzle_migrations').all() as Array<{ tag: string }>).map(
      (r) => r.tag,
    ),
  )

  const files = readdirSync(folder)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  let appliedCount = 0
  for (const file of files) {
    const tag = file.replace(/\.sql$/, '')
    if (applied.has(tag)) continue
    const sql = readFileSync(join(folder, file), 'utf8')
    // drizzle-kit separates multiple statements with --> statement-breakpoint
    const statements = sql
      .split(/-->\s*statement-breakpoint/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const stmt of statements) db.exec(stmt)
    db.prepare('INSERT INTO __drizzle_migrations (tag, applied_at) VALUES (?, ?)').run(
      tag,
      Date.now(),
    )
    appliedCount++
    log.info({ tag }, 'migration applied')
  }

  log.info({ applied: appliedCount, total: files.length }, 'migrations complete')
}
