import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { sql } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { getDb } from '@hub/db'
import { runs, captures, agentLocks, briefings } from '@hub/db/schema'
import { getLogger, loadEnv } from '@hub/shared'
import {
  ErrorEnvelope,
  StatusResponse,
  CapturesList,
  CaptureDetail,
  CaptureCreateRequest,
  CaptureCreateResponse,
  RunDetail,
  BriefingsList,
  BriefingDetail,
  AskRequest,
  AskResponse,
  Settings,
} from '@hub/shared/contracts'

const log = getLogger('api')

/**
 * Typed API surface. Every route is declared with `createRoute` so:
 *   1. request/response shapes are validated by zod,
 *   2. TS inference flows from contracts → handler,
 *   3. the server emits an OpenAPI document at `/api/openapi.json` that
 *      the web/CLI clients consume in v0.5 #2.
 */
export const api = new OpenAPIHono()

const json = <S extends z.ZodTypeAny>(schema: S) => ({
  'application/json': { schema },
})

const errorResp = (description: string) => ({
  description,
  content: json(ErrorEnvelope),
})

const IdParam = z.object({ id: z.string().min(1) })
const DateParam = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

// ─────────────────────────── GET /api/status ────────────────────────────
const statusRoute = createRoute({
  method: 'get',
  path: '/status',
  responses: {
    200: { description: 'Counts + leases + 20 most recent runs', content: json(StatusResponse) },
  },
})

api.openapi(statusRoute, async (c) => {
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

  return c.json(
    {
      version: '0.3.0',
      counts: { captures: captureCount, runs: runCount, leases: leases.length },
      leases,
      recentRuns: recent,
    },
    200,
  )
})

// ─────────────────────── GET /api/captures?limit= ──────────────────────
const capturesListQuery = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((v) => (v ? Math.min(Number(v), 200) : 50)),
})

const capturesListRoute = createRoute({
  method: 'get',
  path: '/captures',
  request: { query: capturesListQuery },
  responses: {
    200: { description: 'Most recent captures', content: json(CapturesList) },
  },
})

api.openapi(capturesListRoute, async (c) => {
  const { limit } = c.req.valid('query')
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
  return c.json({ captures: rows }, 200)
})

// ───────────────────────── POST /api/captures ──────────────────────────
const captureCreateRoute = createRoute({
  method: 'post',
  path: '/captures',
  request: { body: { content: json(CaptureCreateRequest) } },
  responses: {
    201: {
      description: 'Capture ingested (new or duplicate)',
      content: json(CaptureCreateResponse),
    },
    400: errorResp('Validation error'),
  },
})

api.openapi(captureCreateRoute, async (c) => {
  const body = c.req.valid('json')
  const { ingest } = await import('@hub/capture/ingest')
  const result = await ingest({
    source: body.source ?? 'manual',
    text: body.text,
    rawContentRef: `web:${Date.now()}`,
  })
  log.info({ captureId: result.id, dup: result.isDuplicate }, 'capture from web')
  return c.json(result, 201)
})

// ─────────────────────── GET /api/captures/:id ─────────────────────────
const captureDetailRoute = createRoute({
  method: 'get',
  path: '/captures/{id}',
  request: { params: IdParam },
  responses: {
    200: { description: 'Capture detail with body', content: json(CaptureDetail) },
    404: errorResp('Not found'),
  },
})

api.openapi(captureDetailRoute, async (c) => {
  const { id } = c.req.valid('param')
  const db = getDb()
  const row = await db
    .select({
      id: captures.id,
      source: captures.source,
      receivedAt: captures.receivedAt,
      contentHash: captures.contentHash,
      rawContentRef: captures.rawContentRef,
      classifiedDomain: captures.classifiedDomain,
      classifiedType: captures.classifiedType,
      confidence: captures.confidence,
      entitiesJson: captures.entitiesJson,
      actionItemsJson: captures.actionItemsJson,
      decisionsJson: captures.decisionsJson,
      dispatchedToJson: captures.dispatchedToJson,
      modelUsed: captures.modelUsed,
      status: captures.status,
      errorMessage: captures.errorMessage,
    })
    .from(captures)
    .where(sql`id = ${id}`)
    .get()
  if (!row) return c.json({ error: 'not_found' }, 404)

  let body: string | null = null
  if (row.rawContentRef && /\.md$/i.test(row.rawContentRef)) {
    try {
      body = await readFile(row.rawContentRef, 'utf8')
    } catch {
      body = null
    }
  }

  const detail = {
    id: row.id,
    source: row.source,
    receivedAt: row.receivedAt,
    classifiedDomain: row.classifiedDomain,
    classifiedType: row.classifiedType,
    status: row.status,
    rawContentRef: row.rawContentRef,
    contentHash: row.contentHash,
    confidence: row.confidence,
    modelUsed: row.modelUsed,
    errorMessage: row.errorMessage,
    entities: safeParse(row.entitiesJson, []),
    actionItems: safeParse(row.actionItemsJson, []),
    decisions: safeParse(row.decisionsJson, []),
    dispatchedTo: safeParse(row.dispatchedToJson, []),
    body,
  }
  return c.json(detail, 200)
})

// ───────────────────────── POST /api/ask ───────────────────────────────
const askRoute = createRoute({
  method: 'post',
  path: '/ask',
  request: { body: { content: json(AskRequest) } },
  responses: {
    200: { description: 'Agent run result', content: json(AskResponse) },
    400: errorResp('Validation error'),
    500: errorResp('Agent run failed'),
  },
})

api.openapi(askRoute, async (c) => {
  const body = c.req.valid('json')
  const { run } = await import('@hub/agent-runtime')
  try {
    const result = await run(
      { input: body.input, source: 'pwa', forceLocal: !!body.forceLocal },
      { agentName: 'ask-oneshot', scopes: ['knowledge', 'tasks'] },
    )
    return c.json(result, 200)
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, 'ask failed')
    return c.json({ error: err instanceof Error ? err.message : 'unknown' }, 500)
  }
})

// ─────────────────────── GET /api/runs/:id ─────────────────────────────
const runDetailRoute = createRoute({
  method: 'get',
  path: '/runs/{id}',
  request: { params: IdParam },
  responses: {
    200: { description: 'Run detail', content: json(RunDetail) },
    404: errorResp('Not found'),
  },
})

api.openapi(runDetailRoute, async (c) => {
  const { id } = c.req.valid('param')
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
  // DB column type is `string` but the contract narrows to the R0–R3 union;
  // the schema shape is identical, so the cast is safe at runtime.
  return c.json(row as typeof row & { permissionTier: 'R0' | 'R1' | 'R2' | 'R3' }, 200)
})

// ─────────────────────── GET /api/briefings ────────────────────────────
const briefingsListQuery = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((v) => (v ? Math.min(Number(v), 200) : 30)),
})

const briefingsListRoute = createRoute({
  method: 'get',
  path: '/briefings',
  request: { query: briefingsListQuery },
  responses: {
    200: { description: 'Briefing index', content: json(BriefingsList) },
  },
})

api.openapi(briefingsListRoute, async (c) => {
  const { limit } = c.req.valid('query')
  const db = getDb()
  const rows = await db
    .select({
      date: briefings.date,
      generatedAt: briefings.generatedAt,
      runId: briefings.runId,
      obsidianRef: briefings.obsidianRef,
      rating: briefings.rating,
    })
    .from(briefings)
    .orderBy(sql`date desc`)
    .limit(limit)
    .all()
  return c.json({ briefings: rows }, 200)
})

// ───────────────────── GET /api/briefings/:date ────────────────────────
const briefingDetailRoute = createRoute({
  method: 'get',
  path: '/briefings/{date}',
  request: { params: DateParam },
  responses: {
    200: { description: 'Briefing + body', content: json(BriefingDetail) },
    404: errorResp('Not found'),
  },
})

api.openapi(briefingDetailRoute, async (c) => {
  const { date } = c.req.valid('param')
  const db = getDb()
  const row = await db
    .select()
    .from(briefings)
    .where(sql`date = ${date}`)
    .get()
  if (!row) return c.json({ error: 'not_found' }, 404)

  let body: string | null = null
  if (row.obsidianRef.endsWith('.md')) {
    try {
      body = await readFile(row.obsidianRef, 'utf8')
    } catch (err) {
      log.warn({ ref: row.obsidianRef, err: String(err) }, 'brief body unreadable')
    }
  }
  return c.json({ ...row, body }, 200)
})

// ───────────────────────── GET /api/settings ───────────────────────────
const settingsRoute = createRoute({
  method: 'get',
  path: '/settings',
  responses: {
    200: { description: 'Redacted server config', content: json(Settings) },
  },
})

api.openapi(settingsRoute, (c) => {
  const env = loadEnv()
  return c.json(
    {
      version: '0.3.0',
      timezone: env.HUB_TIMEZONE,
      port: env.HUB_PORT,
      host: env.HUB_HOST,
      vaultPath: env.OBSIDIAN_VAULT_PATH ?? null,
      dbPath: env.HUB_DB_PATH,
      logLevel: env.HUB_LOG_LEVEL,
      models: {
        default: env.HUB_DEFAULT_MODEL,
        localTrivial: env.HUB_LOCAL_MODEL_TRIVIAL,
        localPrivate: env.HUB_LOCAL_MODEL_PRIVATE,
        localFallback: env.HUB_LOCAL_MODEL_FALLBACK,
      },
      dailyUsdCap: env.HUB_DAILY_USD_CAP,
      ollamaUrl: env.OLLAMA_BASE_URL,
      integrations: {
        anthropic: !!env.ANTHROPIC_API_KEY,
        notion: !!env.NOTION_TOKEN,
        obsidian: !!env.OBSIDIAN_API_KEY,
        google: !!env.GOOGLE_OAUTH_CLIENT_ID,
        todoist: !!env.TODOIST_API_TOKEN,
        github: !!env.GITHUB_PAT,
        webhookSecret: !!env.HUB_WEBHOOK_SECRET,
        uiToken: !!env.HUB_UI_TOKEN,
        ntfy: !!env.NTFY_TOPIC,
      },
    },
    200,
  )
})

// ─────────────────── GET /api/openapi.json (spec) ──────────────────────
// Served on the authenticated /api/* namespace so the spec is not public.
// PR #2 (generated client) consumes this at build time.
api.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'Hub API',
    version: '0.3.0',
    description:
      'Private HTTP surface backing the web UI and CLI. All shapes come from @hub/shared/contracts.',
  },
})

function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}
