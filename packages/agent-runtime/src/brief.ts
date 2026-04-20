import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { eq, gte, desc, sql } from 'drizzle-orm'
import { loadEnv, getLogger, type Task } from '@hub/shared'
import { getDb } from '@hub/db'
import { captures, runs, briefings } from '@hub/db/schema'
import { run, type RunResult } from './run.js'

const log = getLogger('brief')

export interface BriefOptions {
  /** YYYY-MM-DD; defaults to today in HUB_TIMEZONE. */
  date?: string
  /** Skip the Agent SDK call and just write a local-only summary (faster, free, no cloud). */
  localOnly?: boolean
  /** Force regeneration even if a briefing row already exists for this date. */
  regenerate?: boolean
  /** Caller source (for the task record). */
  source?: Task['source']
}

export interface BriefResult {
  date: string
  runId: string
  path: string | null
  output: string
  status: RunResult['status']
  cached: boolean
}

/**
 * End-to-end daily brief:
 *  1. Resolve target date in HUB_TIMEZONE.
 *  2. Return cached row if already generated today (unless regenerate=true).
 *  3. Gather local context: today's captures, last 24h runs, recent decisions.
 *  4. Load the brief-generator skill as system prompt.
 *  5. Call the agent runtime with knowledge+workspace MCP scopes (auto-skipped
 *     if their env vars are empty — the brief degrades gracefully to local-only).
 *  6. Write the output to `<vault>/Daily/<date>.md` and record a briefings row.
 *
 * Never throws for "expected" failures (empty vault path, empty MCP, model
 * error) — returns `status='error'` on the RunResult and an honest body.
 */
export async function runBrief(opts: BriefOptions = {}): Promise<BriefResult> {
  const env = loadEnv()
  const date = opts.date ?? todayInTz(env.HUB_TIMEZONE)

  if (!opts.regenerate) {
    const cached = await getCachedBriefing(date)
    if (cached) {
      log.info({ date, runId: cached.runId }, 'brief cache hit')
      const body = await readVaultBody(cached.obsidianRef).catch(() => '')
      return {
        date,
        runId: cached.runId,
        path: cached.obsidianRef,
        output: body,
        status: 'success',
        cached: true,
      }
    }
  }

  const context = await gatherLocalContext(date)
  const skill = await loadSkillOrFallback()
  const prompt = buildBriefPrompt(date, context)

  const task: Task = {
    input: prompt,
    source: opts.source ?? 'cli',
    forceLocal: !!opts.localOnly,
  }

  const r = await run(task, {
    agentName: 'nightly-brief',
    scopes: opts.localOnly ? [] : ['knowledge', 'workspace'],
    permissionTier: 'R1',
    systemPrompt: skill,
    maxTurns: 6,
  })

  const path = await writeToVault(env.OBSIDIAN_VAULT_PATH, date, r.output || emptyBriefBody(date))

  if (r.status === 'success' && path) {
    await recordBriefing(date, r.runId, path)
  }

  return {
    date,
    runId: r.runId,
    path,
    output: r.output,
    status: r.status,
    cached: false,
  }
}

// --- Context gathering ---------------------------------------------------

export interface BriefContext {
  date: string
  capturesToday: Array<{
    id: string
    source: string
    domain: string | null
    type: string | null
    summary: string
  }>
  recentRuns: Array<{ agent: string; status: string; cost: number; when: string }>
  todaySpendUsd: number
}

async function gatherLocalContext(date: string): Promise<BriefContext> {
  const db = getDb()
  const startOfDay = dayStartMs(date)
  const endOfDay = startOfDay + 24 * 3600 * 1000

  const caps = await db
    .select({
      id: captures.id,
      source: captures.source,
      domain: captures.classifiedDomain,
      type: captures.classifiedType,
      ref: captures.rawContentRef,
    })
    .from(captures)
    .where(gte(captures.receivedAt, startOfDay))
    .orderBy(desc(captures.receivedAt))
    .limit(50)
    .all()

  const recent = await db
    .select({
      agent: runs.agentName,
      status: runs.status,
      cost: runs.costUsd,
      startedAt: runs.startedAt,
    })
    .from(runs)
    .where(gte(runs.startedAt, startOfDay))
    .orderBy(desc(runs.startedAt))
    .limit(20)
    .all()

  const spendRow = await db
    .select({ total: sql<number>`coalesce(sum(cost_usd), 0)` })
    .from(runs)
    .where(sql`started_at >= ${startOfDay} AND started_at < ${endOfDay}`)
    .get()

  return {
    date,
    capturesToday: caps.map((c) => ({
      id: c.id,
      source: c.source,
      domain: c.domain,
      type: c.type,
      summary: c.ref, // best we can do without loading the body
    })),
    recentRuns: recent.map((r) => ({
      agent: r.agent,
      status: r.status,
      cost: r.cost,
      when: new Date(r.startedAt).toISOString(),
    })),
    todaySpendUsd: spendRow?.total ?? 0,
  }
}

// --- Prompt + skill loading ----------------------------------------------

function buildBriefPrompt(date: string, ctx: BriefContext): string {
  const capLines =
    ctx.capturesToday.length === 0
      ? '(no captures today)'
      : ctx.capturesToday
          .map((c) => `- [${c.source}] ${c.domain ?? '?'}/${c.type ?? '?'} — ${c.summary}`)
          .join('\n')
  const runLines =
    ctx.recentRuns.length === 0
      ? '(no agent runs today)'
      : ctx.recentRuns
          .map((r) => `- ${r.when}  ${r.agent.padEnd(18)}  ${r.status}  $${r.cost.toFixed(4)}`)
          .join('\n')

  return [
    `Generate the daily brief for ${date}.`,
    '',
    'Follow the brief-generator skill exactly. Start with the date heading in frontmatter, then the six sections.',
    '',
    '## Local context',
    '',
    `**Captures today (${ctx.capturesToday.length}):**`,
    capLines,
    '',
    `**Agent runs today (${ctx.recentRuns.length}):**`,
    runLines,
    '',
    `**Today's spend:** $${ctx.todaySpendUsd.toFixed(4)}`,
    '',
    'Use the MCP tools available to you to fetch calendar events, open tasks, and recent Obsidian notes as needed. If a tool is unavailable, note the gap under Signal and proceed.',
  ].join('\n')
}

async function loadSkillOrFallback(): Promise<string> {
  // Walk upward from cwd to find .claude/skills/brief-generator/SKILL.md. In
  // prod (systemd service) cwd is /var/lib/hub/hub which is the repo root, so
  // the first candidate hits.
  const cwd = process.cwd()
  const candidates = [
    resolve(cwd, '.claude/skills/brief-generator/SKILL.md'),
    resolve(cwd, '../.claude/skills/brief-generator/SKILL.md'),
    resolve(cwd, '../../.claude/skills/brief-generator/SKILL.md'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        const text = await readFile(c, 'utf8')
        return text
      } catch {
        // fall through
      }
    }
  }
  log.warn('brief-generator skill not found; using inline fallback')
  return FALLBACK_SKILL
}

const FALLBACK_SKILL = `
You are the nightly-brief agent. Produce a concise daily brief (400–600 words) in Markdown with these sections, in order:

1. Top three — the three things that matter most for tomorrow
2. What got done today — completed tasks, meetings, decisions
3. What's on deck tomorrow — calendar events + top pending tasks
4. Open loops — waiting-on items with activity in the last 3 days
5. Signal — anything unusual
6. Sources — the refs you used

Output YAML frontmatter with: date, generated (ISO-8601), agent: nightly-brief, model.
Never invent facts. If data is missing, say so under Signal.
If no activity at all, write "No activity to brief on for {date}." and stop.
`.trim()

// --- Vault write ---------------------------------------------------------

async function writeToVault(
  vaultPath: string | undefined,
  date: string,
  body: string,
): Promise<string | null> {
  if (!vaultPath) {
    log.warn('OBSIDIAN_VAULT_PATH not set; brief not written to disk')
    return null
  }
  const filePath = join(vaultPath, 'Daily', `${date}.md`)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, body, 'utf8')
  log.info({ path: filePath }, 'brief written')
  return filePath
}

async function readVaultBody(path: string): Promise<string> {
  if (!path.endsWith('.md') || !existsSync(path)) return ''
  return readFile(path, 'utf8')
}

// --- Briefings table -----------------------------------------------------

async function getCachedBriefing(date: string) {
  const db = getDb()
  return db.select().from(briefings).where(eq(briefings.date, date)).get()
}

async function recordBriefing(date: string, runId: string, path: string): Promise<void> {
  const db = getDb()
  // Upsert (the primary key is date).
  await db
    .insert(briefings)
    .values({
      date,
      generatedAt: Date.now(),
      runId,
      obsidianRef: path,
    })
    .onConflictDoUpdate({
      target: briefings.date,
      set: { generatedAt: Date.now(), runId, obsidianRef: path },
    })
    .run()
}

function emptyBriefBody(date: string): string {
  return `---
date: ${date}
generated: ${new Date().toISOString()}
agent: nightly-brief
model: none
---

No activity to brief on for ${date}.
`
}

// --- Timezone helpers ----------------------------------------------------

/**
 * YYYY-MM-DD for "now" in the given IANA tz. Uses Intl to avoid pulling in a
 * TZ library. Returns UTC date if tz is invalid (best-effort).
 */
export function todayInTz(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const y = parts.find((p) => p.type === 'year')?.value
    const m = parts.find((p) => p.type === 'month')?.value
    const d = parts.find((p) => p.type === 'day')?.value
    if (y && m && d) return `${y}-${m}-${d}`
  } catch {
    // fall through
  }
  return new Date().toISOString().slice(0, 10)
}

function dayStartMs(date: string): number {
  // Interpret as UTC midnight; close enough for a day-window filter on a
  // personal DB. If we need strict local-tz windows we'll revisit.
  return Date.parse(`${date}T00:00:00Z`)
}
