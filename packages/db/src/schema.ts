import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * captures — raw and classified inbound items from all capture sources.
 * `contentHash` is the dedup key for idempotent webhooks.
 */
export const captures = sqliteTable(
  'captures',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(), // CaptureSource enum
    receivedAt: integer('received_at').notNull(), // unix ms
    contentHash: text('content_hash').notNull(),
    rawContentRef: text('raw_content_ref').notNull(), // path or obsidian:// URI
    classifiedDomain: text('classified_domain'),
    classifiedType: text('classified_type'),
    confidence: real('confidence'),
    entitiesJson: text('entities_json').notNull().default('[]'),
    actionItemsJson: text('action_items_json').notNull().default('[]'),
    decisionsJson: text('decisions_json').notNull().default('[]'),
    dispatchedToJson: text('dispatched_to_json').notNull().default('[]'),
    modelUsed: text('model_used'),
    status: text('status').notNull().default('received'), // received|classified|dispatched|error|review
    errorMessage: text('error_message'),
  },
  (t) => ({
    contentHashIdx: index('captures_content_hash_idx').on(t.contentHash),
    receivedAtIdx: index('captures_received_at_idx').on(t.receivedAt),
    statusIdx: index('captures_status_idx').on(t.status),
  }),
)

/**
 * runs — every agent invocation. Used for cost/latency telemetry,
 * audit trail, and reversibility (R1+ runs carry reversalPayload).
 */
export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    agentName: text('agent_name').notNull(),
    parentRunId: text('parent_run_id'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    modelUsed: text('model_used').notNull(), // 'anthropic:claude-...' or 'ollama:phi4-mini'
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    status: text('status').notNull().default('running'), // running|success|error|partial
    mcpServersJson: text('mcp_servers_json').notNull().default('[]'),
    subagentsJson: text('subagents_json').notNull().default('[]'),
    permissionTier: text('permission_tier').notNull().default('R0'),
    /**
     * Reversibility payload. NULL = not reversible.
     * Capped at REVERSAL_PAYLOAD_MAX_BYTES (see locks.ts) — over-cap = NULL.
     */
    reversalPayload: text('reversal_payload'),
    reversedAt: integer('reversed_at'),
    errorMessage: text('error_message'),
    outputRef: text('output_ref'),
    // Prompt orchestration context — null for non-prompt runs
    promptId: text('prompt_id'),
    promptVersion: integer('prompt_version'),
    targetRepo: text('target_repo'),
    runTrigger: text('run_trigger'), // 'scheduled'|'event'|'manual'|'mcp'|'http'
    // Phase 10: adversarial gate — strongest-case-against note, null if no consequential action taken
    adversarialNote: text('adversarial_note'),
  },
  (t) => ({
    agentNameIdx: index('runs_agent_name_idx').on(t.agentName),
    startedAtIdx: index('runs_started_at_idx').on(t.startedAt),
    statusIdx: index('runs_status_idx').on(t.status),
    parentIdx: index('runs_parent_idx').on(t.parentRunId),
  }),
)

/**
 * embeddings — vector index over captures + Obsidian + Notion content.
 * Stored as BLOB; sqlite-vec virtual table created in migrations/0001.
 */
export const embeddings = sqliteTable(
  'embeddings',
  {
    id: text('id').primaryKey(),
    sourceKind: text('source_kind').notNull(), // capture|obsidian|notion
    sourceRef: text('source_ref').notNull(), // capture id, file path, page id
    chunkIdx: integer('chunk_idx').notNull(),
    contentHash: text('content_hash').notNull(),
    text: text('text').notNull(),
    metadataJson: text('metadata_json').notNull().default('{}'),
    indexedAt: integer('indexed_at').notNull(),
  },
  (t) => ({
    sourceIdx: index('embeddings_source_idx').on(t.sourceKind, t.sourceRef),
    contentHashIdx: index('embeddings_content_hash_idx').on(t.contentHash),
  }),
)

/**
 * briefings — index of generated briefings. Body lives in Obsidian.
 */
export const briefings = sqliteTable('briefings', {
  date: text('date').primaryKey(), // YYYY-MM-DD
  generatedAt: integer('generated_at').notNull(),
  runId: text('run_id').notNull(),
  obsidianRef: text('obsidian_ref').notNull(),
  rating: integer('rating'), // 1-5, set via `hub brief --rate`
  notes: text('notes'),
  body: text('body'), // stored in DB so Railway can serve it without Obsidian
})

/**
 * projects — Hub's local mirror of project metadata. Authoritative copy
 * lives in Notion Projects DB; this is a cache for routing/scoping.
 */
export const projects = sqliteTable(
  'projects',
  {
    slug: text('slug').primaryKey(),
    name: text('name').notNull(),
    domain: text('domain').notNull(),
    notionPageId: text('notion_page_id'),
    linearTeamKey: text('linear_team_key'),
    todoistProjectId: text('todoist_project_id'),
    obsidianFolder: text('obsidian_folder'),
    status: text('status').notNull().default('active'),
    lastActivityAt: integer('last_activity_at'),
  },
  (t) => ({
    domainIdx: index('projects_domain_idx').on(t.domain),
    statusIdx: index('projects_status_idx').on(t.status),
  }),
)

/**
 * agent_locks — DB-backed lease table for cron coordination.
 * LOAD-BEARING FIX (v0.3): replaces in-process mutex.
 *
 * Acquire pattern: INSERT ... ON CONFLICT (name) DO UPDATE
 *   SET pid=excluded.pid, lease_until=excluded.lease_until
 *   WHERE lease_until < unixepoch('subsec')*1000;
 *
 * If the WHERE clause matches no row, the lease is held by someone else.
 * Stale-lock eviction is automatic via the WHERE predicate.
 */
export const agentLocks = sqliteTable('agent_locks', {
  agentName: text('agent_name').primaryKey(),
  pid: integer('pid').notNull(),
  acquiredAt: integer('acquired_at').notNull(),
  leaseUntil: integer('lease_until').notNull(),
  holderHostname: text('holder_hostname').notNull(),
})

/**
 * mcp_consents — per-MCP-server (and optionally per-tool) consent grants.
 * Written by `hub` CLI consent prompt; read by agent-runtime before
 * connecting to a server for the first time.
 */
export const mcpConsents = sqliteTable('mcp_consents', {
  id: text('id').primaryKey(), // serverName or serverName:toolName
  serverName: text('server_name').notNull(),
  toolName: text('tool_name'), // null = server-wide
  scope: text('scope').notNull(), // read|write|destructive
  grantedAt: integer('granted_at').notNull(),
  expiresAt: integer('expires_at'),
  notes: text('notes'),
})

/**
 * feedback — per-run signal from the user: acted / ignored / wrong.
 * Written by the FeedbackBar UI component; read by feedback-review prompt.
 */
export const feedback = sqliteTable(
  'feedback',
  {
    id: text('id').primaryKey(),
    sourceType: text('source_type', { enum: ['ask', 'brief', 'prompt_run'] }).notNull(),
    sourceId: text('source_id').notNull(),
    signal: text('signal', { enum: ['acted', 'ignored', 'wrong'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    sourceIdx: index('feedback_source_idx').on(t.sourceType, t.sourceId),
    signalIdx: index('feedback_signal_idx').on(t.signal),
  }),
)

/**
 * prompts — synced from hub-prompts repo. Keyed on id (slug).
 * Upserted by `hub prompt sync`; body is the full markdown content.
 */
export const prompts = sqliteTable('prompts', {
  id: text('id').primaryKey(),
  version: integer('version').notNull().default(1),
  sourceSha: text('source_sha'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  body: text('body').notNull(),
  sensitivity: text('sensitivity').notNull().default('low'), // low|medium|high
  complexity: text('complexity').notNull().default('standard'), // trivial|standard|complex
  inputsSchema: text('inputs_schema'), // JSON
  outputConfig: text('output_config').notNull().default('{}'), // JSON
  tags: text('tags').notNull().default('[]'), // JSON array
  syncedAt: integer('synced_at').notNull(),
  enabled: integer('enabled').notNull().default(1),
})

/**
 * prompt_targets — synced from hub-registry. Wires prompts to repos+triggers.
 * UNIQUE(repo, prompt_id, trigger) — one target per prompt×repo×trigger tuple.
 */
export const promptTargets = sqliteTable(
  'prompt_targets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    repo: text('repo').notNull(), // 'owner/repo' slug
    promptId: text('prompt_id').notNull(), // FK → prompts.id (CASCADE enforced in SQL)
    trigger: text('trigger').notNull(), // 'cron:0 5 * * *'|'manual'|'event:push'
    whenExpr: text('when_expr'), // expr-eval expression; null = always run
    branch: text('branch').notNull().default('main'),
    sensitivityOverride: text('sensitivity_override'), // low|medium|high
    args: text('args').notNull().default('{}'), // JSON
    enabled: integer('enabled').notNull().default(1),
    sourceSha: text('source_sha'),
    syncedAt: integer('synced_at').notNull(),
    lastRunId: text('last_run_id'),
    lastRunAt: integer('last_run_at'),
  },
  (t) => ({
    repoPromptTriggerIdx: uniqueIndex('prompt_targets_repo_prompt_trigger_idx').on(
      t.repo,
      t.promptId,
      t.trigger,
    ),
    triggerIdx: index('prompt_targets_trigger_idx').on(t.trigger),
    repoIdx: index('prompt_targets_repo_idx').on(t.repo),
  }),
)

export const allTables = {
  captures,
  runs,
  embeddings,
  briefings,
  projects,
  agentLocks,
  mcpConsents,
  feedback,
  prompts,
  promptTargets,
} as const

export const REVERSAL_PAYLOAD_MAX_BYTES = 64 * 1024
export const DEFAULT_LEASE_MS = 5 * 60 * 1000 // 5 min default; agents override per run
export const sqlNow = sql`(unixepoch('subsec') * 1000)`
