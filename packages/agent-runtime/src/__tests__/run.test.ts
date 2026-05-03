import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as DbModule from '@hub/db'
import { _resetEnvCache } from '@hub/shared'

vi.mock('@hub/db', async () => {
  const actual = await vi.importActual<typeof DbModule>('@hub/db')
  return {
    ...actual,
    getTodaySpendUsd: vi.fn(async () => 0),
  }
})

let tmpDir: string

async function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-run-test-'))
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(tmpDir, 'hub.db')
  process.env['HUB_LOG_DIR'] = join(tmpDir, 'logs')
  process.env['HUB_LOG_LEVEL'] = 'fatal'
  process.env['HUB_SKIP_DOTENV'] = '1'
  process.env['HUB_TIMEZONE'] = 'UTC'
  process.env['HUB_QUIET_HOURS'] = '00-24'
  _resetEnvCache()

  const { closeDb, migrate } = await import('@hub/db')
  closeDb()
  migrate()

  return import('../run.js')
}

describe('run quiet-hours gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    const { closeDb } = await import('@hub/db')
    closeDb()
    delete process.env['HUB_QUIET_HOURS']
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('persists a blocked R2 run instead of dropping the audit trail', async () => {
    const { run } = await setup()
    const result = await run(
      { input: 'send the email', source: 'cli', forceLocal: false },
      { agentName: 'test-r2', permissionTier: 'R2' },
    )

    expect(result.status).toBe('error')
    expect(result.runId).toBeTruthy()
    expect(result.output).toContain('quiet hours active')

    const { getDb } = await import('@hub/db')
    const { runs } = await import('@hub/db/schema')
    const { eq } = await import('drizzle-orm')
    const row = await getDb().select().from(runs).where(eq(runs.id, result.runId)).get()
    expect(row?.modelUsed).toBe('blocked:quiet-hours')
    expect(row?.status).toBe('error')
    expect(row?.errorMessage).toBe('quiet_hours_blocked')
    expect(row?.outputRef).toContain('quiet hours active')
  })
})
