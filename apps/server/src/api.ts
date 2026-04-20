import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { getDb } from '@hub/db'
import { runs, captures, agentLocks } from '@hub/db/schema'
import { getLogger } from '@hub/shared'

const log = getLogger('api')

export const api = new Hono()

/**
 * GET /api/status
 * Returns DB counts, active leases, and the 20 most recent runs.
 * Matches the `hub status` CLI command so the UI and CLI agree.
 */
api.get('/status', async (c) => {
  const db = getDb()
  const captureCount =
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(captures)
        .get()
    )?.n ?? 0
  const runCount =
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(runs)
        .get()
    )?.n ?? 0
  const leases = await db
    .select({
      name: agentLocks.agentName,
      holderPid: agentLocks.pid,
      leaseUntil: agentLocks.leaseUntil,
      acquiredAt: agentLocks.acquiredAt,
    })
    .from(agentLocks)
    .all()
  const recent = await db
    .select({
      id: runs.id,
      agent: runs.agentName,
      model: runs.modelUsed,
      status: runs.status,
      startedAt: runs.startedAt,
      endedAt: runs.endedAt,
      costUsd: runs.costUsd,
    })
    .from(runs)
    .orderBy(sql`started_at desc`)
    .limit(20)
    .all()

  return c.json({
    version: '0.3.0',
    counts: { captures: captureCount, runs: runCount, leases: leases.length },
    leases,
    recentRuns: recent,
  })
})

/**
 * GET /api/captures?limit=50
 * Most recent captures, newest first.
 */
api.get('/captures', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const db = getDb()
  const rows = await db
    .select({
      id: captures.id,
      source: captures.source,
      receivedAt: captures.receivedAt,
      classifiedDomain: captures.classifiedDomain,
      classifiedType: captures.classifiedType,
      status: captures.status,
      rawContentRef: captures.rawContentRef,
    })
    .from(captures)
    .orderBy(sql`received_at desc`)
    .limit(limit)
    .all()
  return c.json({ captures: rows })
})

/**
 * POST /api/captures
 * Body: { text: string, source?: CaptureSource }
 * Dedups by content hash. Mirrors `hub capture "<text>"`.
 */
api.post('/captures', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.text !== 'string' || body.text.trim().length === 0) {
    return c.json({ error: 'text is required' }, 400)
  }
  const { ingest } = await import('@hub/capture/ingest')
  const result = await ingest({
    source: body.source ?? 'manual',
    text: body.text,
    rawContentRef: `web:${Date.now()}`,
  })
  log.info({ captureId: result.id, dup: result.isDuplicate }, 'capture from web')
  return c.json(result, 201)
})

/**
 * POST /api/ask
 * Body: { input: string, forceLocal?: boolean }
 * One-shot query that goes through the privacy router. Mirrors `hub ask`.
 */
api.post('/ask', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.input !== 'string' || body.input.trim().length === 0) {
    return c.json({ error: 'input is required' }, 400)
  }
  const { run } = await import('@hub/agent-runtime')
  try {
    const result = await run(
      { input: body.input, source: 'pwa', forceLocal: !!body.forceLocal },
      { agentName: 'ask-oneshot', scopes: ['knowledge', 'tasks'] },
    )
    return c.json(result)
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, 'ask failed')
    return c.json({ error: err instanceof Error ? err.message : 'unknown' }, 500)
  }
})

/**
 * GET /api/runs/:id
 * Full run detail.
 */
api.get('/runs/:id', async (c) => {
  const id = c.req.param('id')
  const db = getDb()
  const row = await db
    .select({
      id: runs.id,
      agentName: runs.agentName,
      parentRunId: runs.parentRunId,
      startedAt: runs.startedAt,
      endedAt: runs.endedAt,
      modelUsed: runs.modelUsed,
      inputTokens: runs.inputTokens,
      outputTokens: runs.outputTokens,
      costUsd: runs.costUsd,
      status: runs.status,
      permissionTier: runs.permissionTier,
      errorMessage: runs.errorMessage,
      outputRef: runs.outputRef,
    })
    .from(runs)
    .where(sql`id = ${id}`)
    .get()
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(row)
})
