import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

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

export const allTables = {
  captures,
  runs,
  embeddings,
  briefings,
  projects,
  agentLocks,
  mcpConsents,
} as const

export const REVERSAL_PAYLOAD_MAX_BYTES = 64 * 1024
export const DEFAULT_LEASE_MS = 5 * 60 * 1000 // 5 min default; agents override per run
export const sqlNow = sql`(unixepoch('subsec') * 1000)`
