import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetEnvCache } from '@hub/shared'

let tmpDir: string

vi.mock('../classify.js', () => ({
  classify: vi.fn(),
}))

async function freshDb() {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-ingest-classify-test-'))
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

  const ingestMod = await import('../ingest.js')
  const classifyMod = await import('../classify.js')
  return { ingest: ingestMod.ingest, classify: classifyMod.classify as ReturnType<typeof vi.fn> }
}

describe('ingest → classify wiring', () => {
  beforeEach(() => {
    delete process.env['HUB_DB_PATH']
    vi.clearAllMocks()
  })

  afterEach(async () => {
    const { closeDb } = await import('@hub/db')
    closeDb()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('persists classifier output and transitions status to classified', async () => {
    const { ingest, classify } = await freshDb()
    classify.mockResolvedValueOnce({
      domain: 'personal',
      type: 'task',
      confidence: 0.82,
      entities: ['Bob'],
      actionItems: [{ text: 'call Bob', assignee: 'me' }],
      decisions: [],
      summary: 'reminder to call Bob',
    })

    const result = await ingest({
      source: 'manual',
      text: 'remind me to call Bob about the roof',
      rawContentRef: 'cli://manual/1',
    })

    expect(result.isDuplicate).toBe(false)
    expect(result.classified).toBe(true)
    expect(classify).toHaveBeenCalledOnce()

    const { getDb } = await import('@hub/db')
    const { captures } = await import('@hub/db/schema')
    const { eq } = await import('drizzle-orm')
    const row = await getDb().select().from(captures).where(eq(captures.id, result.id)).get()
    expect(row?.status).toBe('classified')
    expect(row?.classifiedDomain).toBe('personal')
    expect(row?.classifiedType).toBe('task')
    expect(row?.confidence).toBeCloseTo(0.82)
    expect(JSON.parse(row?.entitiesJson ?? '[]')).toEqual(['Bob'])
    expect(JSON.parse(row?.actionItemsJson ?? '[]')).toHaveLength(1)
    expect(row?.modelUsed).toMatch(/^ollama:/)
  })

  it('classifier failure leaves row at status=received and does not throw', async () => {
    const { ingest, classify } = await freshDb()
    classify.mockRejectedValueOnce(new Error('ollama unreachable'))

    const result = await ingest({
      source: 'superwhisper',
      text: 'voice memo content',
      rawContentRef: 'sw://1',
    })

    expect(result.isDuplicate).toBe(false)
    expect(result.classified).toBe(false)

    const { getDb } = await import('@hub/db')
    const { captures } = await import('@hub/db/schema')
    const { eq } = await import('drizzle-orm')
    const row = await getDb().select().from(captures).where(eq(captures.id, result.id)).get()
    expect(row?.status).toBe('received')
    expect(row?.classifiedDomain).toBeNull()
  })

  it('classify=false skips the classifier entirely', async () => {
    const { ingest, classify } = await freshDb()

    const result = await ingest({
      source: 'manual',
      text: 'skip me',
      rawContentRef: 'cli://manual/2',
      classify: false,
    })

    expect(result.classified).toBe(false)
    expect(classify).not.toHaveBeenCalled()
  })
})
