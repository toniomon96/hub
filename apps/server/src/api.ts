import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { sql, desc, gte, eq, count, sum } from 'drizzle-orm'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { getDb } from '@hub/db'
import { runs, captures, agentLocks, briefings, feedback } from '@hub/db/schema'
import { getLogger, loadEnv } from '@hub/shared'
import { loadConsoleDashboard, loadConsoleRoadmap } from './console-data.js'
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
  const { run, resolveAskPolicy } = await import('@hub/agent-runtime')
  try {
    const policy = await resolveAskPolicy({
      mode: body.mode,
      lifeArea: body.lifeArea,
      projectRef: body.projectRef,
      requestedScopes: body.requestedScopes,
      governorDomain: body.governorDomain,
      legacyDomain: body.domain,
    })
    const result = await run(
      {
        input: body.input,
        source: 'pwa',
        forceLocal: !!body.forceLocal,
        assistantMode: policy.mode,
        ...(policy.lifeArea ? { lifeAreaHint: policy.lifeArea } : {}),
        ...(body.projectRef ? { projectRef: body.projectRef } : {}),
        governorDomain: policy.governorDomain,
      },
      {
        agentName: 'ask-oneshot',
        scopes: policy.appliedScopes,
        requestedScopes: (body.requestedScopes ?? []).filter((scope) =>
          ['knowledge', 'workspace', 'tasks', 'code', 'system'].includes(scope),
        ) as Array<'knowledge' | 'workspace' | 'tasks' | 'code' | 'system'>,
        permissionTier: policy.permissionTier,
      },
    )
    return c.json(
      {
        ...result,
        appliedMode: policy.mode,
        ...(policy.lifeArea ? { lifeArea: policy.lifeArea } : {}),
        ...(body.projectRef ? { projectRef: body.projectRef } : {}),
        governorDomain: policy.governorDomain,
        appliedScopes: policy.appliedScopes,
        deniedScopes: policy.deniedScopes,
        authority: policy.authority,
      },
      200,
    )
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, 'ask failed')
    return c.json({ error: err instanceof Error ? err.message : 'unknown' }, 500)
  }
})

// ─────────────────── POST /api/ask/stream (SSE) ─────────────────────────
/**
 * Server-Sent Events streaming variant of /api/ask. Not declared via
 * `createRoute` because `@hono/zod-openapi` doesn't model `text/event-stream`
 * responses cleanly — the SSE event schema (`AskStreamMeta|Token|Final|Error`)
 * is documented in `@hub/shared/contracts/ask.ts` and pinned by tests.
 *
 * The client disconnecting (abort signal) ends the upstream runStream()
 * generator within one iteration, which finalizes the run as `partial`.
 */
api.post('/ask/stream', async (c) => {
  let parsedBody: unknown
  try {
    parsedBody = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  const parsed = AskRequest.safeParse(parsedBody)
  if (!parsed.success) return c.json({ error: 'input required' }, 400)
  const body = parsed.data

  const { runStream, resolveAskPolicy } = await import('@hub/agent-runtime')
  const policy = await resolveAskPolicy({
    mode: body.mode,
    lifeArea: body.lifeArea,
    projectRef: body.projectRef,
    requestedScopes: body.requestedScopes,
    governorDomain: body.governorDomain,
    legacyDomain: body.domain,
  })
  const ctrl = new AbortController()
  c.req.raw.signal?.addEventListener('abort', () => ctrl.abort(), { once: true })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: string, data: unknown) => {
        const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(frame))
      }
      try {
        for await (const ev of runStream(
          {
            input: body.input,
            source: 'pwa',
            forceLocal: !!body.forceLocal,
            assistantMode: policy.mode,
            ...(policy.lifeArea ? { lifeAreaHint: policy.lifeArea } : {}),
            ...(body.projectRef ? { projectRef: body.projectRef } : {}),
            governorDomain: policy.governorDomain,
          },
          {
            agentName: 'ask-oneshot',
            scopes: policy.appliedScopes,
            requestedScopes: (body.requestedScopes ?? []).filter((scope) =>
              ['knowledge', 'workspace', 'tasks', 'code', 'system'].includes(scope),
            ) as Array<'knowledge' | 'workspace' | 'tasks' | 'code' | 'system'>,
            permissionTier: policy.permissionTier,
            signal: ctrl.signal,
          },
        )) {
          if (ev.type === 'meta') {
            write('meta', {
              runId: ev.runId,
              modelUsed: ev.modelUsed,
              appliedMode: policy.mode,
              ...(policy.lifeArea ? { lifeArea: policy.lifeArea } : {}),
              ...(body.projectRef ? { projectRef: body.projectRef } : {}),
              governorDomain: policy.governorDomain,
              appliedScopes: policy.appliedScopes,
              deniedScopes: policy.deniedScopes,
              authority: policy.authority,
            })
          } else if (ev.type === 'token') write('token', { text: ev.text })
          else if (ev.type === 'final') {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { type: _t, ...payload } = ev
            write('final', {
              ...payload,
              appliedMode: policy.mode,
              ...(policy.lifeArea ? { lifeArea: policy.lifeArea } : {}),
              ...(body.projectRef ? { projectRef: body.projectRef } : {}),
              governorDomain: policy.governorDomain,
              appliedScopes: policy.appliedScopes,
              deniedScopes: policy.deniedScopes,
              authority: policy.authority,
            })
          } else {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { type: _t, ...payload } = ev
            write('error', payload)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error({ err: message }, 'ask/stream failed')
        const frame = `event: error\ndata: ${JSON.stringify({ message })}\n\n`
        controller.enqueue(encoder.encode(frame))
      } finally {
        controller.close()
      }
    },
    cancel() {
      ctrl.abort()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering if proxied
    },
  })
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

  // DB body is the primary source (works on Railway without Obsidian).
  // Fall back to Obsidian file only when body column is null (rows written before migration).
  let body: string | null = row.body ?? null
  if (!body && row.obsidianRef.endsWith('.md')) {
    try {
      body = await readFile(row.obsidianRef, 'utf8')
    } catch (err) {
      log.warn({ ref: row.obsidianRef, err: String(err) }, 'brief body unreadable from vault')
    }
  }
  return c.json({ ...row, body }, 200)
})

// ───────────────────────── GET /api/brief/latest ───────────────────────
const briefLatestRoute = createRoute({
  method: 'get',
  path: '/brief/latest',
  responses: {
    200: { description: 'Most recent briefing + body', content: json(BriefingDetail) },
    404: errorResp('No briefings yet'),
  },
})

api.openapi(briefLatestRoute, async (c) => {
  const db = getDb()
  const row = await db
    .select()
    .from(briefings)
    .orderBy(sql`date desc`)
    .limit(1)
    .get()
  if (!row) return c.json({ error: 'not_found' }, 404)

  let body: string | null = row.body ?? null
  if (!body && row.obsidianRef.endsWith('.md')) {
    try {
      body = await readFile(row.obsidianRef, 'utf8')
    } catch {
      // vault unreachable; body stays null
    }
  }
  return c.json({ ...row, body }, 200)
})

// ─────────────────────── POST /api/brief/regenerate ────────────────────
const briefRegenerateRoute = createRoute({
  method: 'post',
  path: '/brief/regenerate',
  responses: {
    200: { description: 'Regenerated brief', content: json(BriefingDetail) },
    500: errorResp('Brief generation failed'),
  },
})

api.openapi(briefRegenerateRoute, async (c) => {
  const { runBrief } = await import('@hub/agent-runtime')
  const result = await runBrief({ regenerate: true, source: 'pwa' })
  if (result.status === 'error') {
    return c.json({ error: result.output || 'brief generation failed' }, 500)
  }
  const db = getDb()
  const row = await db
    .select()
    .from(briefings)
    .where(sql`date = ${result.date}`)
    .get()
  if (!row) return c.json({ error: 'brief row missing after generation' }, 500)
  return c.json({ ...row, body: row.body ?? result.output }, 200)
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

// ───────────────────── GET /api/console/dashboard ─────────────────────
const ConsoleSourceSchema = z.object({
  adapter: z.enum(['local', 'github']),
  playbookRoot: z.string().nullable(),
  generatedAt: z.string(),
  warnings: z.array(z.string()),
})

const ConsoleChecklistItemSchema = z.object({
  text: z.string(),
  checked: z.boolean(),
  priority: z.boolean(),
  children: z.array(z.string()),
})

const ConsoleRepoManifestSchema = z.object({
  folder: z.string(),
  repo_id: z.string().nullable(),
  display_name: z.string().nullable(),
  repo_type: z.string().nullable(),
  owner: z.string().nullable(),
  sensitivity_tier: z.number().nullable(),
  status: z.string().nullable(),
  domains: z.array(z.string()),
  allowed_context_consumers: z.array(z.string()),
  artifact_roots: z.array(z.string()),
  source_of_truth_files: z.array(z.string()),
  validation_errors: z.array(z.string()),
})

const ConsoleDashboardResponse = z.object({
  source: ConsoleSourceSchema,
  stats: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      subtext: z.string(),
      tone: z.enum(['ok', 'warn', 'empty']),
    }),
  ),
  weekly: z.object({
    weekOf: z.string().nullable(),
    items: z.array(ConsoleChecklistItemSchema),
    emptyMessage: z.string(),
    sourcePath: z.string(),
  }),
  outreach: z.object({
    rows: z.array(
      z.object({
        date: z.string(),
        name: z.string(),
        channel: z.string(),
        ask: z.string(),
        status: z.string(),
        notes: z.string(),
      }),
    ),
    sentThisWeek: z.number(),
    target: z.number(),
    emptyMessage: z.string(),
    sourcePath: z.string(),
  }),
  pipeline: z.object({
    activeEngagements: z.number(),
    pipelineFiles: z.number(),
    emptyMessage: z.string(),
    sourcePath: z.string(),
  }),
  proofArtifacts: z.object({
    repos: z.array(ConsoleRepoManifestSchema),
    emptyMessage: z.string(),
  }),
  roadmap: z.object({
    currentPhase: z.string(),
    principle: z.string().nullable(),
    nextAction: z.string(),
    notToBuild: z.array(z.string()),
  }),
})

const ConsoleRoadmapResponse = z.object({
  source: ConsoleSourceSchema.extend({ sourcePath: z.string() }),
  title: z.string(),
  principle: z.string().nullable(),
  currentPhase: z.string(),
  phases: z.array(z.object({ title: z.string(), body: z.string() })),
  notToBuild: z.array(z.string()),
  cashFlow: z.array(z.object({ period: z.string(), expectedRevenue: z.string() })),
})

const consoleDashboardRoute = createRoute({
  method: 'get',
  path: '/console/dashboard',
  responses: {
    200: {
      description: 'Read-only consulting console dashboard',
      content: json(ConsoleDashboardResponse),
    },
    500: errorResp('Console dashboard load failed'),
  },
})

api.openapi(consoleDashboardRoute, async (c) => {
  try {
    return c.json(await loadConsoleDashboard(), 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'console dashboard load failed')
    return c.json({ error: message }, 500)
  }
})

// ────────────────────── GET /api/console/roadmap ───────────────────────
const consoleRoadmapRoute = createRoute({
  method: 'get',
  path: '/console/roadmap',
  responses: {
    200: {
      description: 'Read-only consulting roadmap view',
      content: json(ConsoleRoadmapResponse),
    },
    500: errorResp('Console roadmap load failed'),
  },
})

api.openapi(consoleRoadmapRoute, async (c) => {
  try {
    return c.json(await loadConsoleRoadmap(), 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'console roadmap load failed')
    return c.json({ error: message }, 500)
  }
})

// ─────────────────── POST /api/prompts/sync ─────────────────────────────

const PromptSyncResponse = z.object({
  promptsUpserted: z.number(),
  targetsUpserted: z.number(),
  targetsRemoved: z.number(),
  errors: z.array(z.object({ file: z.string(), error: z.string() })),
})

const promptSyncRoute = createRoute({
  method: 'post',
  path: '/prompts/sync',
  responses: {
    200: {
      description: 'Sync complete',
      content: { 'application/json': { schema: PromptSyncResponse } },
    },
    500: { description: 'Sync failed', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})

api.openapi(promptSyncRoute, async (c) => {
  try {
    const { syncPrompts } = await import('@hub/prompts/sync')
    const { registerScheduledPromptJobs } = await import('@hub/prompts/schedule')
    const result = await syncPrompts()
    await registerScheduledPromptJobs()
    return c.json(result, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'prompts sync failed')
    return c.json({ error: message }, 500)
  }
})

// ─────────────────── POST /api/prompts/run ──────────────────────────────

const PromptRunRequest = z.object({
  promptId: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().optional(),
  args: z.record(z.unknown()).optional(),
})

const PromptRunResponse = z.object({
  runId: z.string(),
})

const promptRunRoute = createRoute({
  method: 'post',
  path: '/prompts/run',
  request: { body: { content: { 'application/json': { schema: PromptRunRequest } } } },
  responses: {
    200: {
      description: 'Dispatch triggered',
      content: { 'application/json': { schema: PromptRunResponse } },
    },
    500: {
      description: 'Dispatch failed',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})

api.openapi(promptRunRoute, async (c) => {
  const body = c.req.valid('json')
  try {
    const { dispatchPromptRun } = await import('@hub/prompts/dispatcher')
    const result = await dispatchPromptRun({
      promptId: body.promptId,
      repo: body.repo,
      ...(body.branch !== undefined ? { branch: body.branch } : {}),
      ...(body.args !== undefined ? { args: body.args } : {}),
      trigger: 'manual',
    })
    return c.json(result, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'prompt run dispatch failed')
    return c.json({ error: message }, 500)
  }
})

// ─────────────────── GET /api/prompts ───────────────────────────────────

const PromptListRow = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  sensitivity: z.string(),
  complexity: z.string(),
  enabled: z.number(),
})

const promptListRoute = createRoute({
  method: 'get',
  path: '/prompts/list',
  responses: {
    200: { description: 'Prompt library', content: json(z.array(PromptListRow)) },
    500: errorResp('Query failed'),
  },
})

api.openapi(promptListRoute, async (c) => {
  try {
    const { prompts } = await import('@hub/db/schema')
    const db = getDb()
    const rows = await db
      .select({
        id: prompts.id,
        title: prompts.title,
        description: prompts.description,
        sensitivity: prompts.sensitivity,
        complexity: prompts.complexity,
        enabled: prompts.enabled,
      })
      .from(prompts)
      .all()
    return c.json(rows, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'prompts list failed')
    return c.json({ error: message }, 500)
  }
})

// ──────────────────── Registry management routes ────────────────────────

const EditResultSchema = z.object({
  diff: z.string(),
  committed: z.boolean(),
  commitSha: z.string().optional(),
  pushedTo: z.string().optional(),
  syncSummary: z
    .object({
      promptsUpserted: z.number(),
      targetsUpserted: z.number(),
      targetsRemoved: z.number(),
      errors: z.array(z.object({ file: z.string(), error: z.string() })),
    })
    .optional(),
})

const RegistryAddRequest = z.object({
  repo: z.string().min(1),
  branch: z.string().optional(),
  sensitivity: z.enum(['low', 'medium', 'high']).optional(),
  enabled: z.boolean().optional(),
  dryRun: z.boolean().optional(),
})

const RegistryWireRequest = z.object({
  repo: z.string().min(1),
  promptId: z.string().min(1),
  trigger: z.string().min(1),
  when: z.string().optional(),
  args: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
  dryRun: z.boolean().optional(),
})

const RegistryRemoveRequest = z.object({
  repo: z.string().min(1),
  promptId: z.string().optional(),
  trigger: z.string().optional(),
  dryRun: z.boolean().optional(),
})

const registryAddRoute = createRoute({
  method: 'post',
  path: '/registry/add',
  request: { body: { content: json(RegistryAddRequest) } },
  responses: {
    200: { description: 'Edit applied', content: json(EditResultSchema) },
    500: errorResp('Edit failed'),
  },
})

api.openapi(registryAddRoute, async (c) => {
  const body = c.req.valid('json')
  try {
    const { addTarget } = await import('@hub/prompts/edit')
    const result = await addTarget(body)
    return c.json(result, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'registry add failed')
    return c.json({ error: message }, 500)
  }
})

const registryWireRoute = createRoute({
  method: 'post',
  path: '/registry/wire',
  request: { body: { content: json(RegistryWireRequest) } },
  responses: {
    200: { description: 'Edit applied', content: json(EditResultSchema) },
    500: errorResp('Edit failed'),
  },
})

api.openapi(registryWireRoute, async (c) => {
  const body = c.req.valid('json')
  try {
    const { wirePrompt } = await import('@hub/prompts/edit')
    const result = await wirePrompt(body)
    return c.json(result, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'registry wire failed')
    return c.json({ error: message }, 500)
  }
})

const registryRemoveRoute = createRoute({
  method: 'post',
  path: '/registry/remove',
  request: { body: { content: json(RegistryRemoveRequest) } },
  responses: {
    200: { description: 'Edit applied', content: json(EditResultSchema) },
    500: errorResp('Edit failed'),
  },
})

api.openapi(registryRemoveRoute, async (c) => {
  const body = c.req.valid('json')
  try {
    const { removeEntry } = await import('@hub/prompts/edit')
    const result = await removeEntry(body)
    return c.json(result, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'registry remove failed')
    return c.json({ error: message }, 500)
  }
})

const RegistryTargetsQuery = z.object({ repo: z.string().optional() })
const RegistryTargetRow = z.object({
  id: z.number(),
  repo: z.string(),
  promptId: z.string(),
  trigger: z.string(),
  enabled: z.number(),
  lastRunAt: z.number().nullable(),
})

const registryTargetsRoute = createRoute({
  method: 'get',
  path: '/registry/targets',
  request: { query: RegistryTargetsQuery },
  responses: {
    200: { description: 'Targets list', content: json(z.array(RegistryTargetRow)) },
    500: errorResp('Query failed'),
  },
})

api.openapi(registryTargetsRoute, async (c) => {
  const { repo } = c.req.valid('query')
  try {
    const { promptTargets } = await import('@hub/db/schema')
    const { eq: drizzleEq } = await import('drizzle-orm')
    const db = getDb()
    const rows = await db
      .select({
        id: promptTargets.id,
        repo: promptTargets.repo,
        promptId: promptTargets.promptId,
        trigger: promptTargets.trigger,
        enabled: promptTargets.enabled,
        lastRunAt: promptTargets.lastRunAt,
      })
      .from(promptTargets)
      .where(repo ? drizzleEq(promptTargets.repo, repo) : undefined)
      .all()
    return c.json(rows, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'registry targets query failed')
    return c.json({ error: message }, 500)
  }
})

// ─────────────────────── POST /api/feedback ────────────────────────────
const feedbackCreateRoute = createRoute({
  method: 'post',
  path: '/feedback',
  request: {
    body: {
      content: json(
        z.object({
          sourceType: z.enum(['ask', 'brief', 'prompt_run']),
          sourceId: z.string().min(1),
          signal: z.enum(['acted', 'ignored', 'wrong']),
        }),
      ),
      required: true,
    },
  },
  responses: {
    201: { description: 'Feedback recorded', content: json(z.object({ id: z.string() })) },
    500: errorResp('Write failed'),
  },
})

api.openapi(feedbackCreateRoute, async (c) => {
  const { sourceType, sourceId, signal } = c.req.valid('json')
  const db = getDb()
  const id = crypto.randomUUID()
  try {
    await db
      .insert(feedback)
      .values({ id, sourceType, sourceId, signal, createdAt: Date.now() })
      .run()
    return c.json({ id }, 201)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'feedback insert failed')
    return c.json({ error: message }, 500)
  }
})

// ─────────────────────── GET /api/feedback ─────────────────────────────
const feedbackListQuery = z.object({
  since: z.string().optional(), // e.g. "30d"
  sourceType: z.enum(['ask', 'brief', 'prompt_run']).optional(),
})

const feedbackListRoute = createRoute({
  method: 'get',
  path: '/feedback',
  request: { query: feedbackListQuery },
  responses: {
    200: {
      description: 'Feedback rows',
      content: json(
        z.object({
          feedback: z.array(
            z.object({
              id: z.string(),
              sourceType: z.string(),
              sourceId: z.string(),
              signal: z.string(),
              createdAt: z.number(),
            }),
          ),
        }),
      ),
    },
  },
})

api.openapi(feedbackListRoute, async (c) => {
  const { since, sourceType } = c.req.valid('query')
  const db = getDb()

  let sinceMs = 0
  if (since) {
    const m = since.match(/^(\d+)d$/)
    if (m) sinceMs = Date.now() - Number(m[1]) * 86_400_000
  }

  const rows = await db
    .select()
    .from(feedback)
    .where(
      sinceMs > 0 && sourceType
        ? sql`created_at >= ${sinceMs} AND source_type = ${sourceType}`
        : sinceMs > 0
          ? sql`created_at >= ${sinceMs}`
          : sourceType
            ? sql`source_type = ${sourceType}`
            : sql`1=1`,
    )
    .orderBy(desc(feedback.createdAt))
    .limit(500)
    .all()

  return c.json({ feedback: rows }, 200)
})

// ─────────────────────── GET /api/context ──────────────────────────────
const contextGetRoute = createRoute({
  method: 'get',
  path: '/context',
  responses: {
    200: {
      description: 'Raw context.md body + metadata',
      content: json(z.object({ body: z.string(), updatedAt: z.string().nullable() })),
    },
  },
})

api.openapi(contextGetRoute, async (c) => {
  const contextPath = process.env['HUB_CONTEXT_PATH'] ?? './data/context.md'
  const exists = existsSync(contextPath)
  const body = exists ? await readFile(contextPath, 'utf8').catch(() => '') : ''
  const updatedAt = exists ? statSync(contextPath).mtime.toISOString() : null
  return c.json({ body, updatedAt }, 200)
})

// ─────────────────────── PUT /api/context ──────────────────────────────
const contextPutRoute = createRoute({
  method: 'put',
  path: '/context',
  request: { body: { content: json(z.object({ body: z.string().min(1) })), required: true } },
  responses: {
    200: { description: 'Saved', content: json(z.object({ ok: z.literal(true) })) },
    500: errorResp('Write failed'),
  },
})

api.openapi(contextPutRoute, async (c) => {
  const { body } = c.req.valid('json')
  const contextPath = process.env['HUB_CONTEXT_PATH'] ?? './data/context.md'
  try {
    await writeFile(contextPath, body, 'utf8')
    return c.json({ ok: true as const }, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'context write failed')
    return c.json({ error: message }, 500)
  }
})

// ──────────────────── POST /api/context/append ─────────────────────────
const contextAppendRoute = createRoute({
  method: 'post',
  path: '/context/append',
  request: {
    body: {
      content: json(z.object({ section: z.string().min(1), entry: z.string().min(1) })),
      required: true,
    },
  },
  responses: {
    200: { description: 'Appended', content: json(z.object({ ok: z.literal(true) })) },
    500: errorResp('Append failed'),
  },
})

api.openapi(contextAppendRoute, async (c) => {
  const { section, entry } = c.req.valid('json')
  try {
    const { appendToContext } = await import('@hub/agent-runtime')
    await appendToContext(section, entry)
    return c.json({ ok: true as const }, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message, section }, 'context append failed')
    return c.json({ error: message }, 500)
  }
})

// ──────────────────── GET /api/observability/runs ───────────────────────
const obsRunSchema = z.object({
  id: z.string(),
  agentName: z.string(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  modelUsed: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  status: z.string(),
  promptId: z.string().nullable(),
  adversarialNote: z.string().nullable(),
})

const obsRunsRoute = createRoute({
  method: 'get',
  path: '/observability/runs',
  request: { query: z.object({ since: z.string().optional(), limit: z.string().optional() }) },
  responses: {
    200: { description: 'Run trace', content: json(z.array(obsRunSchema)) },
    500: errorResp('Query failed'),
  },
})

api.openapi(obsRunsRoute, async (c) => {
  try {
    const db = getDb()
    const { since, limit: limitStr } = c.req.valid('query')
    const sinceMs = parseSinceMs(since ?? '7d')
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 200)
    const rows = await db
      .select({
        id: runs.id,
        agentName: runs.agentName,
        startedAt: runs.startedAt,
        endedAt: runs.endedAt,
        modelUsed: runs.modelUsed,
        inputTokens: runs.inputTokens,
        outputTokens: runs.outputTokens,
        costUsd: runs.costUsd,
        status: runs.status,
        promptId: runs.promptId,
        adversarialNote: runs.adversarialNote,
      })
      .from(runs)
      .where(gte(runs.startedAt, sinceMs))
      .orderBy(desc(runs.startedAt))
      .limit(limit)
      .all()
    return c.json(rows, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'observability runs failed')
    return c.json({ error: message }, 500)
  }
})

// ─────────────────── GET /api/observability/costs ────────────────────────
const obsCostRow = z.object({
  promptId: z.string().nullable(),
  modelUsed: z.string(),
  totalUsd: z.number(),
  runCount: z.number(),
})
const obsCostsRoute = createRoute({
  method: 'get',
  path: '/observability/costs',
  request: { query: z.object({ since: z.string().optional() }) },
  responses: {
    200: { description: 'Cost breakdown', content: json(z.array(obsCostRow)) },
    500: errorResp('Query failed'),
  },
})

api.openapi(obsCostsRoute, async (c) => {
  try {
    const db = getDb()
    const { since } = c.req.valid('query')
    const sinceMs = parseSinceMs(since ?? '30d')
    const rows = await db
      .select({
        promptId: runs.promptId,
        modelUsed: runs.modelUsed,
        totalUsd: sum(runs.costUsd),
        runCount: count(runs.id),
      })
      .from(runs)
      .where(gte(runs.startedAt, sinceMs))
      .groupBy(runs.promptId, runs.modelUsed)
      .all()
    return c.json(
      rows.map((r) => ({ ...r, totalUsd: Number(r.totalUsd ?? 0), runCount: Number(r.runCount) })),
      200,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'observability costs failed')
    return c.json({ error: message }, 500)
  }
})

// ─────────────────── GET /api/observability/prompts ──────────────────────
const obsPromptRow = z.object({
  promptId: z.string(),
  runCount: z.number(),
  actedCount: z.number(),
  ignoredCount: z.number(),
  wrongCount: z.number(),
  lastRunAt: z.number().nullable(),
})
const obsPromptsRoute = createRoute({
  method: 'get',
  path: '/observability/prompts',
  request: { query: z.object({ since: z.string().optional() }) },
  responses: {
    200: { description: 'Prompt performance', content: json(z.array(obsPromptRow)) },
    500: errorResp('Query failed'),
  },
})

api.openapi(obsPromptsRoute, async (c) => {
  try {
    const db = getDb()
    const { since } = c.req.valid('query')
    const sinceMs = parseSinceMs(since ?? '30d')
    const runRows = await db
      .select({
        promptId: runs.promptId,
        runCount: count(runs.id),
        lastRunAt: sql<number>`max(${runs.startedAt})`,
      })
      .from(runs)
      .where(gte(runs.startedAt, sinceMs))
      .groupBy(runs.promptId)
      .all()

    // Join feedback through runs so signals are scoped to the correct promptId.
    const feedbackByPrompt = await db
      .select({
        promptId: runs.promptId,
        signal: feedback.signal,
        cnt: count(feedback.id),
      })
      .from(feedback)
      .innerJoin(runs, eq(feedback.sourceId, runs.id))
      .where(gte(feedback.createdAt, sinceMs))
      .groupBy(runs.promptId, feedback.signal)
      .all()

    // Build promptId → { signal → count } map
    const fbByPrompt = new Map<string, Record<string, number>>()
    for (const row of feedbackByPrompt) {
      if (!row.promptId) continue
      const entry = fbByPrompt.get(row.promptId) ?? {}
      entry[row.signal] = Number(row.cnt)
      fbByPrompt.set(row.promptId, entry)
    }

    const out = runRows
      .filter((r) => r.promptId !== null)
      .map((r) => {
        const pid = r.promptId!
        const fb = fbByPrompt.get(pid) ?? {}
        return {
          promptId: pid,
          runCount: Number(r.runCount),
          actedCount: fb['acted'] ?? 0,
          ignoredCount: fb['ignored'] ?? 0,
          wrongCount: fb['wrong'] ?? 0,
          lastRunAt: r.lastRunAt ?? null,
        }
      })
    return c.json(out, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'observability prompts failed')
    return c.json({ error: message }, 500)
  }
})

// ──────────────── GET /api/observability/sensitivity ────────────────────
const obsSensRow = z.object({ provider: z.string(), count: z.number() })
const obsSensRoute = createRoute({
  method: 'get',
  path: '/observability/sensitivity',
  request: { query: z.object({ since: z.string().optional() }) },
  responses: {
    200: { description: 'Sensitivity distribution', content: json(z.array(obsSensRow)) },
    500: errorResp('Query failed'),
  },
})

api.openapi(obsSensRoute, async (c) => {
  try {
    const db = getDb()
    const { since } = c.req.valid('query')
    const sinceMs = parseSinceMs(since ?? '30d')
    const rows = await db
      .select({
        provider: sql<string>`case when ${runs.modelUsed} like 'ollama:%' then 'ollama' else 'anthropic' end`,
        count: count(runs.id),
      })
      .from(runs)
      .where(gte(runs.startedAt, sinceMs))
      .groupBy(sql`case when ${runs.modelUsed} like 'ollama:%' then 'ollama' else 'anthropic' end`)
      .all()
    return c.json(
      rows.map((r) => ({ ...r, count: Number(r.count) })),
      200,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'observability sensitivity failed')
    return c.json({ error: message }, 500)
  }
})

// ─────────────────────── GET /api/exports ──────────────────────────────
const exportsListRoute = createRoute({
  method: 'get',
  path: '/exports',
  responses: {
    200: {
      description: 'Export file list',
      content: json(
        z.array(z.object({ name: z.string(), sizeBytes: z.number(), createdAt: z.string() })),
      ),
    },
    500: errorResp('List failed'),
  },
})

api.openapi(exportsListRoute, async (c) => {
  try {
    const { listExports } = await import('./jobs/export.js')
    return c.json(listExports(), 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'exports list failed')
    return c.json({ error: message }, 500)
  }
})

// ──────────────────── GET /api/exports/:file ────────────────────────────
const exportFileRoute = createRoute({
  method: 'get',
  path: '/exports/{file}',
  request: { params: z.object({ file: z.string().min(1) }) },
  responses: {
    200: {
      description: 'Export file contents',
      content: { 'application/octet-stream': { schema: z.string() } },
    },
    400: errorResp('Invalid filename'),
    404: errorResp('Not found'),
    500: errorResp('Read failed'),
  },
})

api.openapi(exportFileRoute, async (c) => {
  const { file } = c.req.valid('param')
  try {
    const { exportFilePath } = await import('./jobs/export.js')
    const filePath = exportFilePath(file)
    if (!existsSync(filePath)) return c.json({ error: 'not found' }, 404)
    const contents = await readFile(filePath, 'utf8')
    return new Response(contents, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${file}"`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('invalid export filename')) return c.json({ error: message }, 400)
    log.error({ err: message, file }, 'export file read failed')
    return c.json({ error: message }, 500)
  }
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

function parseSinceMs(since: string): number {
  const match = since.match(/^(\d+)([dhm])$/)
  if (!match) return Date.now() - 7 * 24 * 60 * 60 * 1000
  const n = parseInt(match[1]!, 10)
  const unit = match[2]!
  const ms = unit === 'd' ? n * 86_400_000 : unit === 'h' ? n * 3_600_000 : n * 60_000
  return Date.now() - ms
}

function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}
