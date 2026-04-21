import { afterAll, afterEach, beforeAll, beforeEach, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { _resetEnvCache } from '@hub/shared'

// Persistent log dir to avoid pino async race on Windows
let sharedLogDir: string
let testDirs: string[] = []

beforeAll(() => {
  sharedLogDir = mkdtempSync(join(tmpdir(), 'hub-dispatcher-logs-'))
  mkdirSync(join(sharedLogDir, 'logs'), { recursive: true })
})

afterAll(() => {
  rmSync(sharedLogDir, { recursive: true, force: true })
})

beforeEach(() => {
  testDirs = []
  vi.resetModules()
})

afterEach(async () => {
  vi.restoreAllMocks()
  const { closeDb } = await import('@hub/db')
  closeDb()
  delete process.env['HUB_DB_PATH']
  _resetEnvCache()
  for (const d of testDirs) rmSync(d, { recursive: true, force: true })
  testDirs = []
})

function freshDbEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-dispatcher-db-'))
  testDirs.push(dir)
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(dir, 'hub.db')
  process.env['HUB_LOG_DIR'] = join(sharedLogDir, 'logs')
  process.env['HUB_LOG_LEVEL'] = 'error'
  process.env['HUB_SKIP_DOTENV'] = '1'
  _resetEnvCache()
}

async function seedPromptAndTarget(whenExpr?: string) {
  const { getRawDb } = await import('@hub/db')
  const raw = getRawDb()
  const now = Date.now()
  raw
    .prepare(
      `INSERT INTO prompts (id, version, title, description, body, sensitivity, complexity, output_config, tags, synced_at, enabled)
       VALUES ('test-prompt', 1, 'Test', 'desc', 'Hello {{repo}}', 'low', 'standard', '{}', '[]', ${now}, 1)`,
    )
    .run()
  raw
    .prepare(
      `INSERT INTO prompt_targets (repo, prompt_id, trigger, when_expr, branch, args, enabled, synced_at)
       VALUES ('org/repo', 'test-prompt', 'manual', ${whenExpr ? `'${whenExpr}'` : 'NULL'}, 'main', '{}', 1, ${now})`,
    )
    .run()
  const target = raw.prepare('SELECT id FROM prompt_targets LIMIT 1').get() as { id: number }
  return target.id
}

it('dispatches a prompt run and returns a runId', async () => {
  freshDbEnv()
  const { closeDb } = await import('@hub/db')
  closeDb()
  const { migrate } = await import('@hub/db/migrate')
  migrate()

  const targetId = await seedPromptAndTarget()

  // Mock the heavy dependencies
  vi.doMock('@hub/agent-runtime/run', () => ({
    run: vi
      .fn()
      .mockResolvedValue({ runId: 'run-abc', output: '## Summary\nDone.', modelUsed: 'test' }),
  }))
  vi.doMock('../outputs.js', () => ({
    handleOutputs: vi.fn().mockResolvedValue(undefined),
  }))

  const { dispatchPromptRun } = await import('../dispatcher.js')
  const result = await dispatchPromptRun({ targetId, trigger: 'manual' })

  expect(result.runId).toBe('run-abc')
})

it('records a skipped run when when_expr is falsy', async () => {
  freshDbEnv()
  const { closeDb } = await import('@hub/db')
  closeDb()
  const { migrate } = await import('@hub/db/migrate')
  migrate()

  const targetId = await seedPromptAndTarget('x > 100')

  vi.doMock('@hub/agent-runtime/run', () => ({
    run: vi.fn().mockResolvedValue({ runId: 'run-xyz', output: '', modelUsed: 'test' }),
  }))
  vi.doMock('../outputs.js', () => ({
    handleOutputs: vi.fn().mockResolvedValue(undefined),
  }))

  const { dispatchPromptRun } = await import('../dispatcher.js')
  const result = await dispatchPromptRun({ targetId, trigger: 'scheduled', args: { x: 5 } })

  // Should return a run id but with 'skipped' status
  expect(result.runId).toBeTruthy()

  const { getRawDb } = await import('@hub/db')
  const row = getRawDb()
    .prepare('SELECT status, error_message FROM runs WHERE id = ?')
    .get(result.runId) as { status: string; error_message: string }
  expect(row.status).toBe('skipped')
  expect(row.error_message).toBe('when_expr_false')
})

it('throws when prompt not found', async () => {
  freshDbEnv()
  const { closeDb } = await import('@hub/db')
  closeDb()
  const { migrate } = await import('@hub/db/migrate')
  migrate()

  vi.doMock('@hub/agent-runtime/run', () => ({
    run: vi.fn(),
  }))
  vi.doMock('../outputs.js', () => ({
    handleOutputs: vi.fn(),
  }))

  const { dispatchPromptRun } = await import('../dispatcher.js')
  await expect(
    dispatchPromptRun({ promptId: 'nonexistent', repo: 'org/repo', trigger: 'manual' }),
  ).rejects.toThrow(/Prompt "nonexistent" not found/)
})
