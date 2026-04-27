import { createHash, randomUUID } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabase'

export interface HubStatus {
  version: string
  counts: { captures: number; runs: number; leases: number }
  leases: Array<{
    name: string
    holderPid: number
    leaseUntil: number
    acquiredAt: number
  }>
  recentRuns: Array<{
    id: string
    agent: string
    model: string
    status: string
    startedAt: number
    endedAt: number | null
    costUsd: number | null
  }>
  runtime?: {
    host: 'vercel'
    database: 'supabase'
    localOnly: string[]
  }
}

export type CronJobName =
  | 'morning-brief'
  | 'nightly-brief'
  | 'week-retro'
  | 'week-planning'
  | 'spend-warning'
  | 'prompt-schedules'
  | 'weekly-export'

export type WebhookSource = 'granola' | 'plaud' | 'superwhisper' | 'martin' | 'manual'

export interface WebhookResult {
  eventId: string
  captureId: string | null
  duplicate: boolean
  status: 'accepted' | 'duplicate' | 'no_text_field'
}

export async function loadHubStatus(): Promise<HubStatus> {
  requireSupabase()
  const db = getSupabaseAdmin()

  const [captureCount, runCount, leasesResult, recentRunsResult] = await Promise.all([
    countRows('captures'),
    countRows('runs'),
    db
      .from('agent_locks')
      .select('agent_name, pid, lease_until, acquired_at')
      .order('lease_until', { ascending: false })
      .limit(50),
    db
      .from('runs')
      .select('id, agent_name, model_used, status, started_at, ended_at, cost_usd')
      .order('started_at', { ascending: false })
      .limit(20),
  ])

  if (leasesResult.error) throw new Error(leasesResult.error.message)
  if (recentRunsResult.error) throw new Error(recentRunsResult.error.message)

  const leases = asRows(leasesResult.data).map((row) => ({
    name: stringField(row, 'agent_name'),
    holderPid: numberField(row, 'pid'),
    leaseUntil: numberField(row, 'lease_until'),
    acquiredAt: numberField(row, 'acquired_at'),
  }))

  const recentRuns = asRows(recentRunsResult.data).map((row) => ({
    id: stringField(row, 'id'),
    agent: stringField(row, 'agent_name'),
    model: stringField(row, 'model_used'),
    status: stringField(row, 'status'),
    startedAt: numberField(row, 'started_at'),
    endedAt: nullableNumberField(row, 'ended_at'),
    costUsd: nullableNumberField(row, 'cost_usd'),
  }))

  return {
    version: '0.3.0',
    counts: { captures: captureCount, runs: runCount, leases: leases.length },
    leases,
    recentRuns,
    runtime: {
      host: 'vercel',
      database: 'supabase',
      localOnly: ['ollama', 'obsidian-vault', 'desktop-mcp', 'shell', 'local-filesystem'],
    },
  }
}

export async function recordCronRun(job: CronJobName): Promise<Record<string, unknown>> {
  requireSupabase()
  const status = localWorkerRequiredJobs.has(job) ? 'local_worker_required' : 'recorded'
  const detail = {
    message:
      status === 'local_worker_required'
        ? `${job} is registered on Vercel Cron, but execution requires the future local worker.`
        : `${job} was recorded by the Vercel cron endpoint.`,
  }

  const { data, error } = await getSupabaseAdmin()
    .from('cron_runs')
    .insert({
      job_name: job,
      status,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      detail,
    })
    .select('id, job_name, status, started_at, ended_at, detail')
    .single()

  if (error) throw new Error(error.message)
  return isRecord(data) ? data : {}
}

export async function recordWebhook(
  source: WebhookSource,
  rawBody: string,
  payload: Record<string, unknown>,
  deliveryId: string | null,
): Promise<WebhookResult> {
  requireSupabase()
  const db = getSupabaseAdmin()
  const payloadHash = sha256(rawBody)

  const existing = await db
    .from('webhook_events')
    .select('id, capture_id, status')
    .eq('source', source)
    .eq(deliveryId ? 'delivery_id' : 'payload_hash', deliveryId ?? payloadHash)
    .maybeSingle()

  if (existing.error) throw new Error(existing.error.message)
  if (existing.data && isRecord(existing.data)) {
    return {
      eventId: stringField(existing.data, 'id'),
      captureId: nullableStringField(existing.data, 'capture_id'),
      duplicate: true,
      status: 'duplicate',
    }
  }

  const text = extractWebhookText(payload)
  const captureId = text ? randomUUID() : null
  if (text) {
    const { error: captureError } = await db.from('captures').insert({
      id: captureId,
      source,
      received_at: Date.now(),
      content_hash: sha256(text),
      raw_content_ref: `webhook:${source}:${deliveryId ?? payloadHash}`,
      status: 'received',
      entities_json: [],
      action_items_json: [],
      decisions_json: [],
      dispatched_to_json: [],
    })
    if (captureError) throw new Error(captureError.message)
  }

  const eventStatus = text ? 'accepted' : 'no_text_field'
  const { data, error } = await db
    .from('webhook_events')
    .insert({
      source,
      delivery_id: deliveryId,
      payload_hash: payloadHash,
      capture_id: captureId,
      status: eventStatus,
      payload,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  return {
    eventId: isRecord(data) ? stringField(data, 'id') : '',
    captureId,
    duplicate: false,
    status: eventStatus,
  }
}

export function requireSupabase(): void {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured for the Vercel Hub runtime.')
  }
}

async function countRows(table: string): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from(table)
    .select('*', { count: 'exact', head: true })
  if (error) throw new Error(error.message)
  return count ?? 0
}

const localWorkerRequiredJobs = new Set<CronJobName>([
  'morning-brief',
  'nightly-brief',
  'week-retro',
  'week-planning',
  'prompt-schedules',
  'weekly-export',
])

function extractWebhookText(payload: Record<string, unknown>): string | null {
  for (const key of ['text', 'transcript', 'body']) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function nullableStringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  return typeof value === 'number' ? value : Number(value ?? 0)
}

function nullableNumberField(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  return typeof value === 'number' ? value : Number(value)
}
