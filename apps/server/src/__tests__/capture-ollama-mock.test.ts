import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetEnvCache } from '@hub/shared'

/**
 * Regression test for v0.4 #3 (capture ollama-mock interop).
 *
 * Two changes make `vi.mock('@hub/models/ollama')` reliably intercept the
 * classifier call from apps/server tests:
 *
 * 1. `packages/capture/tsup.config.ts` sets `bundle: false`, so the built
 *    dist preserves the `@hub/models/ollama` specifier in classify.js
 *    rather than hoisting it into an opaque shared chunk.
 *
 * 2. `apps/server/vitest.config.ts` aliases `@hub/*` workspace specifiers
 *    to their `src/*.ts` sources so Vite transforms the full import graph
 *    (it otherwise treats workspace dist as node_modules and skips it,
 *    which defeats vi.mock at the module-boundary).
 *
 * If either regresses, this test fires a live Ollama request and either
 * hangs (Ollama unreachable) or completes without calling the mock.
 */

let tmpDir: string

vi.mock('@hub/models/ollama', () => ({
  ollamaJson: vi.fn(),
}))

async function freshDb() {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-capture-regress-'))
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(tmpDir, 'hub.db')
  process.env['HUB_LOG_DIR'] = tmpdir()
  process.env['HUB_LOG_LEVEL'] = 'fatal'
  process.env['HUB_SKIP_DOTENV'] = '1'
  _resetEnvCache()

  const { closeDb, migrate } = await import('@hub/db')
  closeDb()
  migrate()

  const { ingest } = await import('@hub/capture/ingest')
  const { ollamaJson } = await import('@hub/models/ollama')
  return { ingest, ollamaJson: ollamaJson as unknown as ReturnType<typeof vi.fn> }
}

describe('capture dist import chain (regression for v0.4 #3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    const { closeDb } = await import('@hub/db')
    closeDb()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('vi.mock reaches ollamaJson when called from capture (classify path)', async () => {
    const { ingest, ollamaJson } = await freshDb()
    ollamaJson.mockResolvedValueOnce({
      domain: 'personal',
      type: 'thought',
      confidence: 0.9,
      entities: [],
      actionItems: [],
      decisions: [],
      summary: 'quick note',
    })

    const result = await ingest({
      source: 'manual',
      text: 'buy milk on the way home',
      rawContentRef: 'test',
      // Skip Obsidian filesystem write — irrelevant to this check.
      fileToInbox: false,
    })

    expect(result.isDuplicate).toBe(false)
    expect(result.classified).toBe(true)
    expect(ollamaJson).toHaveBeenCalledTimes(1)
  })
})
