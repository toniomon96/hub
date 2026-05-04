import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetEnvCache, _resetLoggerCache } from '@hub/shared'

// Stable log dir for the test process. Do not delete it in afterAll: pino opens
// file destinations asynchronously, and Vitest 4 reports that delayed open as an
// unhandled error if the directory disappears during teardown.
let sharedLogDir: string
let testDirs: string[] = []

beforeAll(() => {
  sharedLogDir = join(tmpdir(), 'hub-test-logs')
  mkdirSync(join(sharedLogDir, 'logs'), { recursive: true })
})

afterAll(() => {
  _resetLoggerCache()
})

async function freshDb(prefix = 'hub-migration-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  testDirs.push(dir)
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(dir, 'hub.db')
  process.env['HUB_LOG_DIR'] = join(sharedLogDir, 'logs')
  process.env['HUB_LOG_LEVEL'] = 'error'
  process.env['HUB_SKIP_DOTENV'] = '1'
  _resetEnvCache()

  const { closeDb } = await import('../client.js')
  closeDb()

  const { migrate } = await import('../migrate.js')
  migrate()

  const { getRawDb } = await import('../client.js')
  return { raw: getRawDb(), dir }
}

describe('migration 0001_prompt_orchestration', () => {
  beforeEach(() => {
    delete process.env['HUB_DB_PATH']
    testDirs = []
  })

  afterEach(async () => {
    const { closeDb } = await import('../client.js')
    closeDb()
    _resetLoggerCache()
    for (const d of testDirs) rmSync(d, { recursive: true, force: true })
    testDirs = []
  })

  it('creates prompts and prompt_targets tables on a fresh DB', async () => {
    const { raw } = await freshDb()

    const tables = raw
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>

    const names = tables.map((t) => t.name)
    expect(names).toContain('prompts')
    expect(names).toContain('prompt_targets')
  })

  it('adds four new nullable columns to runs', async () => {
    const { raw } = await freshDb()

    const cols = raw.prepare(`PRAGMA table_info(runs)`).all() as Array<{
      name: string
      notnull: number
      dflt_value: string | null
    }>

    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('prompt_id')
    expect(colNames).toContain('prompt_version')
    expect(colNames).toContain('target_repo')
    expect(colNames).toContain('run_trigger')

    for (const col of ['prompt_id', 'prompt_version', 'target_repo', 'run_trigger']) {
      const def = cols.find((c) => c.name === col)!
      expect(def.notnull, `${col} should be nullable`).toBe(0)
    }
  })

  it('creates indexes on prompt_targets', async () => {
    const { raw } = await freshDb()

    const indexes = raw
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='prompt_targets'`)
      .all() as Array<{ name: string }>

    const idxNames = indexes.map((i) => i.name)
    expect(idxNames).toContain('prompt_targets_repo_prompt_trigger_idx')
    expect(idxNames).toContain('prompt_targets_trigger_idx')
    expect(idxNames).toContain('prompt_targets_repo_idx')
  })

  it('existing runs rows survive the migration with null new columns', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-migration-existing-'))
    testDirs.push(dir)
    process.env['ANTHROPIC_API_KEY'] = 'test-key'
    process.env['HUB_DB_PATH'] = join(dir, 'hub.db')
    process.env['HUB_LOG_DIR'] = join(sharedLogDir, 'logs')
    process.env['HUB_LOG_LEVEL'] = 'error'
    process.env['HUB_SKIP_DOTENV'] = '1'
    _resetEnvCache()

    const { closeDb, getRawDb } = await import('../client.js')
    closeDb()

    // Seed a DB that looks like 0000 was applied but not 0001 yet.
    const { DatabaseSync } = await import('node:sqlite')
    const raw0 = new DatabaseSync(join(dir, 'hub.db'))
    raw0.exec('PRAGMA foreign_keys = ON')

    raw0.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY NOT NULL,
        agent_name TEXT NOT NULL,
        parent_run_id TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        model_used TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0 NOT NULL,
        output_tokens INTEGER DEFAULT 0 NOT NULL,
        cost_usd REAL DEFAULT 0 NOT NULL,
        status TEXT DEFAULT 'running' NOT NULL,
        mcp_servers_json TEXT DEFAULT '[]' NOT NULL,
        subagents_json TEXT DEFAULT '[]' NOT NULL,
        permission_tier TEXT DEFAULT 'R0' NOT NULL,
        reversal_payload TEXT,
        reversed_at INTEGER,
        error_message TEXT,
        output_ref TEXT
      )
    `)

    // briefings is part of migration 0000 — must exist so 0002 (ALTER TABLE briefings) succeeds
    raw0.exec(`
      CREATE TABLE briefings (
        date TEXT PRIMARY KEY NOT NULL,
        generated_at INTEGER NOT NULL,
        run_id TEXT NOT NULL,
        obsidian_ref TEXT NOT NULL,
        rating INTEGER,
        notes TEXT
      )
    `)

    raw0
      .prepare(
        `INSERT INTO runs (id, agent_name, started_at, model_used, status)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .run('existing-run-1', 'ask-oneshot', Date.now(), 'anthropic:claude-sonnet', 'success')

    // Seed the journal so migrate() thinks 0000 is already applied
    raw0.exec(
      `CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, tag TEXT NOT NULL, applied_at INTEGER NOT NULL)`,
    )
    raw0
      .prepare(`INSERT INTO __drizzle_migrations (tag, applied_at) VALUES (?, ?)`)
      .run('0000_uneven_butterfly', Date.now())
    raw0.close()

    // migrate() should now apply only 0001
    const { migrate } = await import('../migrate.js')
    migrate()

    const raw1 = getRawDb()
    const row = raw1.prepare(`SELECT * FROM runs WHERE id = ?`).get('existing-run-1') as
      | Record<string, unknown>
      | undefined
    expect(row).toBeDefined()
    expect(row!['prompt_id']).toBeNull()
    expect(row!['prompt_version']).toBeNull()
    expect(row!['target_repo']).toBeNull()
    expect(row!['run_trigger']).toBeNull()
  })

  it('migration is idempotent — running twice does not error', async () => {
    const { raw } = await freshDb()
    const { migrate } = await import('../migrate.js')
    expect(() => migrate()).not.toThrow()

    const tables = raw
      .prepare(`SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='prompts'`)
      .get() as { cnt: number }
    expect(tables.cnt).toBe(1)
  })
})
