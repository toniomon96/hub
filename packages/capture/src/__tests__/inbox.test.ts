import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetEnvCache } from '@hub/shared'

let tmpDir: string
let vaultDir: string

vi.mock('../classify.js', () => ({
  classify: vi.fn(),
}))

async function freshDbWithVault(vault: string | null) {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-inbox-test-'))
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(tmpDir, 'hub.db')
  process.env['HUB_LOG_DIR'] = join(tmpDir, 'logs')
  process.env['HUB_LOG_LEVEL'] = 'error'
  process.env['HUB_SKIP_DOTENV'] = '1'
  process.env['HUB_SENSITIVITY_PATTERNS'] = 'medical|prescription,SSN'
  process.env['HUB_TIMEZONE'] = 'UTC'
  if (vault) {
    process.env['OBSIDIAN_VAULT_PATH'] = vault
  } else {
    delete process.env['OBSIDIAN_VAULT_PATH']
  }
  _resetEnvCache()

  const { closeDb } = await import('@hub/db')
  closeDb()
  const { migrate } = await import('@hub/db')
  migrate()

  const ingestMod = await import('../ingest.js')
  const classifyMod = await import('../classify.js')
  return { ingest: ingestMod.ingest, classify: classifyMod.classify as ReturnType<typeof vi.fn> }
}

describe('ingest → inbox filing', () => {
  beforeEach(() => {
    delete process.env['HUB_DB_PATH']
    delete process.env['OBSIDIAN_VAULT_PATH']
    vi.clearAllMocks()
  })

  afterEach(async () => {
    const { closeDb } = await import('@hub/db')
    closeDb()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes markdown to $VAULT/inbox with correct frontmatter', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'hub-vault-'))
    const { ingest, classify } = await freshDbWithVault(vaultDir)
    classify.mockResolvedValueOnce({
      domain: 'personal',
      type: 'task',
      confidence: 0.9,
      entities: [],
      actionItems: [],
      decisions: [],
      summary: 'call Bob about roof',
    })

    const result = await ingest({
      source: 'manual',
      text: 'remind me to call Bob',
      rawContentRef: 'cli://1',
    })

    expect(result.filed).toBe(true)

    const { getDb } = await import('@hub/db')
    const { captures } = await import('@hub/db/schema')
    const { eq } = await import('drizzle-orm')
    const row = await getDb().select().from(captures).where(eq(captures.id, result.id)).get()
    expect(row?.status).toBe('dispatched')
    const dispatched: string[] = JSON.parse(row?.dispatchedToJson ?? '[]')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toMatch(/^obsidian:\/\/inbox\/\d{4}-\d{2}-\d{2}-[a-f0-9]{8}\.md$/)

    const filename = dispatched[0]!.replace('obsidian://inbox/', '')
    const outPath = join(vaultDir, 'inbox', filename)
    expect(existsSync(outPath)).toBe(true)
    const content = readFileSync(outPath, 'utf8')
    expect(content).toMatch(/^---\ncreated: /)
    expect(content).toMatch(/source: manual/)
    expect(content).toMatch(/domain: personal/)
    expect(content).toMatch(/captureId: [0-9A-Z]{20,}/)
    expect(content).toMatch(/# call Bob about roof/)
    expect(content).toMatch(/remind me to call Bob/)

    rmSync(vaultDir, { recursive: true, force: true })
  })

  it('skips filing when sensitivity=high (content stays in SQLite only)', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'hub-vault-'))
    const { ingest, classify } = await freshDbWithVault(vaultDir)
    classify.mockResolvedValueOnce({
      domain: 'personal',
      type: 'reference',
      confidence: 0.95,
      entities: [],
      actionItems: [],
      decisions: [],
      summary: 'prescription refill',
    })

    const result = await ingest({
      source: 'manual',
      text: 'prescription refill reminder for lisinopril',
      rawContentRef: 'cli://sens/1',
    })

    expect(result.classified).toBe(true)
    expect(result.filed).toBe(false)

    const { getDb } = await import('@hub/db')
    const { captures } = await import('@hub/db/schema')
    const { eq } = await import('drizzle-orm')
    const row = await getDb().select().from(captures).where(eq(captures.id, result.id)).get()
    expect(row?.status).toBe('classified') // not dispatched
    expect(row?.dispatchedToJson).toBe('[]')

    // And no file should exist in the vault.
    const fs = await import('node:fs/promises')
    const inboxEntries = await fs.readdir(join(vaultDir, 'inbox')).catch(() => [])
    expect(inboxEntries).toHaveLength(0)

    rmSync(vaultDir, { recursive: true, force: true })
  })

  it('skips filing when OBSIDIAN_VAULT_PATH is unset', async () => {
    const { ingest, classify } = await freshDbWithVault(null)
    classify.mockResolvedValueOnce({
      domain: 'misc',
      type: 'thought',
      confidence: 0.6,
      entities: [],
      actionItems: [],
      decisions: [],
      summary: 'random thought',
    })

    const result = await ingest({
      source: 'manual',
      text: 'random thought',
      rawContentRef: 'cli://rt/1',
    })

    expect(result.classified).toBe(true)
    expect(result.filed).toBe(false)

    const { getDb } = await import('@hub/db')
    const { captures } = await import('@hub/db/schema')
    const { eq } = await import('drizzle-orm')
    const row = await getDb().select().from(captures).where(eq(captures.id, result.id)).get()
    expect(row?.status).toBe('classified')
  })

  it('fileToInbox=false disables filing even when vault is configured', async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'hub-vault-'))
    const { ingest, classify } = await freshDbWithVault(vaultDir)
    classify.mockResolvedValueOnce({
      domain: 'misc',
      type: 'thought',
      confidence: 0.6,
      entities: [],
      actionItems: [],
      decisions: [],
      summary: 'a thought',
    })

    const result = await ingest({
      source: 'manual',
      text: 'a fresh thought',
      rawContentRef: 'cli://opt/1',
      fileToInbox: false,
    })

    expect(result.classified).toBe(true)
    expect(result.filed).toBe(false)

    const fs = await import('node:fs/promises')
    const inboxEntries = await fs.readdir(join(vaultDir, 'inbox')).catch(() => [])
    expect(inboxEntries).toHaveLength(0)

    rmSync(vaultDir, { recursive: true, force: true })
  })
})
