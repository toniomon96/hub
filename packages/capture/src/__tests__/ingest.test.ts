import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetEnvCache } from '@hub/shared'

let tmpDir: string

async function freshDb() {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-ingest-test-'))
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(tmpDir, 'hub.db')
  process.env['HUB_LOG_DIR'] = join(tmpDir, 'logs')
  process.env['HUB_LOG_LEVEL'] = 'error'
  process.env['HUB_SKIP_DOTENV'] = '1'
  _resetEnvCache()

  const { closeDb } = await import('@hub/db')
  closeDb()

  const { migrate } = await import('@hub/db')
  migrate()

  return import('../ingest.js')
}

describe('ingest', () => {
  beforeEach(() => {
    delete process.env['HUB_DB_PATH']
  })

  afterEach(async () => {
    const { closeDb } = await import('@hub/db')
    closeDb()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('persists a new capture with isDuplicate=false', async () => {
    const { ingest } = await freshDb()
    const result = await ingest({
      source: 'manual',
      text: 'remind me to call Bob',
      rawContentRef: 'cli://manual/1',
    })
    expect(result.isDuplicate).toBe(false)
    expect(result.id).toMatch(/^[0-9A-Z]{20,}$/) // ULID
  })

  it('returns the same id with isDuplicate=true on identical content', async () => {
    const { ingest } = await freshDb()
    const a = await ingest({
      source: 'superwhisper',
      text: 'meeting notes from standup',
      rawContentRef: 'sw://1',
    })
    const b = await ingest({
      source: 'superwhisper',
      text: 'meeting notes from standup',
      rawContentRef: 'sw://2-retry-of-1',
    })
    expect(a.isDuplicate).toBe(false)
    expect(b.isDuplicate).toBe(true)
    expect(b.id).toBe(a.id)
  })

  it('different content produces different rows', async () => {
    const { ingest } = await freshDb()
    const a = await ingest({
      source: 'manual',
      text: 'first thought',
      rawContentRef: 'cli://1',
    })
    const b = await ingest({
      source: 'manual',
      text: 'second thought',
      rawContentRef: 'cli://2',
    })
    expect(a.id).not.toBe(b.id)
    expect(a.isDuplicate).toBe(false)
    expect(b.isDuplicate).toBe(false)
  })

  it('different source with identical text still dedups (content hash, not source)', async () => {
    const { ingest } = await freshDb()
    const a = await ingest({
      source: 'granola',
      text: 'transcript snippet that appears twice',
      rawContentRef: 'granola://1',
    })
    const b = await ingest({
      source: 'plaud',
      text: 'transcript snippet that appears twice',
      rawContentRef: 'plaud://1',
    })
    expect(b.isDuplicate).toBe(true)
    expect(b.id).toBe(a.id)
  })
})
