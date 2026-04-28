import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { _resetEnvCache, newId } from '@hub/shared'
import { getDb, closeDb, migrate } from '@hub/db'
import { mcpConsents } from '@hub/db/schema'

let tmpDir: string

async function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-ask-policy-test-'))
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(tmpDir, 'hub.db')
  process.env['HUB_LOG_DIR'] = join(tmpDir, 'logs')
  process.env['HUB_LOG_LEVEL'] = 'fatal'
  process.env['HUB_SKIP_DOTENV'] = '1'
  process.env['HUB_TIMEZONE'] = 'UTC'
  _resetEnvCache()
  closeDb()
  migrate()
  return import('../ask-policy.js')
}

describe('resolveAskPolicy', () => {
  beforeEach(() => {
    delete process.env['HUB_CONTEXT_PATH']
  })

  afterEach(() => {
    closeDb()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('defaults generic asks to knowledge only', async () => {
    const { resolveAskPolicy } = await setup()
    const policy = await resolveAskPolicy({ mode: 'clarify', requestedScopes: ['tasks'] })
    expect(policy.appliedScopes).toEqual(['knowledge'])
    expect(policy.deniedScopes).toEqual([
      { scope: 'tasks', reason: 'write scopes require execute mode' },
    ])
  })

  it('denies execute-mode write scopes when authority is only suggest', async () => {
    const { resolveAskPolicy } = await setup()
    const policy = await resolveAskPolicy({
      mode: 'execute',
      lifeArea: 'family',
      requestedScopes: ['tasks'],
    })
    expect(policy.appliedScopes).toEqual(['knowledge'])
    expect(policy.authority).toBe('suggest')
    expect(policy.deniedScopes[0]).toEqual({
      scope: 'tasks',
      reason: 'life-area authority is still suggest',
    })
  })

  it('allows an execute-mode tasks scope when authority and consent are both present', async () => {
    const { resolveAskPolicy } = await setup()
    const db = getDb()
    await db
      .insert(mcpConsents)
      .values({
        id: newId(),
        serverName: 'scope:tasks',
        toolName: null,
        scope: 'write',
        grantedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        notes: 'test',
      })
      .run()

    const policy = await resolveAskPolicy({
      mode: 'execute',
      governorDomain: 'planning',
      requestedScopes: ['tasks'],
    })
    expect(policy.authority).toBe('draft')
    expect(policy.appliedScopes).toEqual(['knowledge', 'tasks'])
    expect(policy.deniedScopes).toEqual([])
    expect(policy.permissionTier).toBe('R2')

    const row = await db
      .select()
      .from(mcpConsents)
      .where(eq(mcpConsents.serverName, 'scope:tasks'))
      .get()
    expect(row?.serverName).toBe('scope:tasks')
  })
})
