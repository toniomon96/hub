import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getDb } from '@hub/db'
import { prompts, promptTargets, runs } from '@hub/db/schema'
import { eq, desc, gte, and, sql } from 'drizzle-orm'
import { dispatchPromptRun } from '@hub/prompts/dispatcher'
import { getLogger } from '@hub/shared'

const log = getLogger('hub-mcp')

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })
const err = (e: unknown) => ({
  content: [{ type: 'text' as const, text: String(e) }],
  isError: true as const,
})

export function buildHubMcpServer(): McpServer {
  const server = new McpServer({ name: 'hub', version: '0.3.0' })

  server.tool('hub.prompt.list', 'List all synced prompts with metadata', async () => {
    try {
      const db = getDb()
      const rows = await db
        .select({
          id: prompts.id,
          version: prompts.version,
          title: prompts.title,
          description: prompts.description,
          sensitivity: prompts.sensitivity,
          complexity: prompts.complexity,
          tags: prompts.tags,
        })
        .from(prompts)
        .all()
      return text(JSON.stringify(rows, null, 2))
    } catch (e) {
      return err(e)
    }
  })

  server.tool(
    'hub.prompt.targets',
    'List prompt targets, optionally filtered by repo. Args for high-sensitivity prompts are redacted.',
    { repo: z.string().optional() },
    async ({ repo }) => {
      try {
        const db = getDb()
        const all = await db
          .select({
            id: promptTargets.id,
            repo: promptTargets.repo,
            promptId: promptTargets.promptId,
            trigger: promptTargets.trigger,
            whenExpr: promptTargets.whenExpr,
            branch: promptTargets.branch,
            args: promptTargets.args,
            enabled: promptTargets.enabled,
            lastRunAt: promptTargets.lastRunAt,
            sensitivity: prompts.sensitivity,
          })
          .from(promptTargets)
          .leftJoin(prompts, eq(promptTargets.promptId, prompts.id))
          .all()

        const filtered = repo ? all.filter((t) => t.repo === repo) : all
        const redacted = filtered.map(({ sensitivity, ...t }) => ({
          ...t,
          args: sensitivity === 'high' ? '[redacted]' : t.args,
        }))
        return text(JSON.stringify(redacted, null, 2))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    'hub.prompt.run',
    'Dispatch a single prompt run manually',
    {
      promptId: z.string().min(1),
      repo: z.string().min(1),
      branch: z.string().optional(),
      args: z.record(z.unknown()).optional(),
    },
    async ({ promptId, repo, branch, args }) => {
      try {
        const result = await dispatchPromptRun({
          promptId,
          repo,
          ...(branch !== undefined ? { branch } : {}),
          ...(args !== undefined ? { args } : {}),
          trigger: 'manual',
        })
        return text(JSON.stringify(result))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    'hub.prompt.run_all',
    'Dispatch all enabled targets for a prompt, with optional repo glob filter',
    {
      promptId: z.string().min(1),
      repoGlob: z.string().optional(),
    },
    async ({ promptId, repoGlob }) => {
      try {
        const db = getDb()
        const targets = await db
          .select()
          .from(promptTargets)
          .where(and(eq(promptTargets.promptId, promptId), eq(promptTargets.enabled, 1)))
          .all()

        const filtered = repoGlob
          ? targets.filter((t) => {
              const pattern = new RegExp('^' + repoGlob.replace(/\*/g, '.*') + '$')
              return pattern.test(t.repo)
            })
          : targets

        const results: Array<{ repo: string; runId?: string; skipped?: string }> = []
        await Promise.all(
          filtered.map(async (t) => {
            try {
              const r = await dispatchPromptRun({ targetId: t.id, trigger: 'manual' })
              results.push({ repo: t.repo, runId: r.runId })
            } catch (e) {
              results.push({ repo: t.repo, skipped: String(e) })
              log.warn({ repo: t.repo, promptId, err: String(e) }, 'run_all dispatch failed')
            }
          }),
        )
        return text(JSON.stringify({ dispatched: results.length, results }, null, 2))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    'hub.prompt.results',
    'Query recent prompt run history',
    {
      repo: z.string().optional(),
      promptId: z.string().optional(),
      since: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    async ({ repo, promptId: pid, since, limit = 50 }) => {
      try {
        const db = getDb()
        const conditions = [sql`${runs.promptId} IS NOT NULL`]
        if (repo) conditions.push(eq(runs.targetRepo, repo))
        if (pid) conditions.push(eq(runs.promptId, pid))
        if (since) conditions.push(gte(runs.startedAt, new Date(since).getTime()))

        const rows = await db
          .select({
            id: runs.id,
            promptId: runs.promptId,
            targetRepo: runs.targetRepo,
            status: runs.status,
            startedAt: runs.startedAt,
            modelUsed: runs.modelUsed,
          })
          .from(runs)
          .where(and(...conditions))
          .orderBy(desc(runs.startedAt))
          .limit(limit)
          .all()

        return text(JSON.stringify(rows, null, 2))
      } catch (e) {
        return err(e)
      }
    },
  )

  // ── Registry management tools ────────────────────────────────────────────

  server.tool(
    'hub.registry.add',
    `Add a repo to hub-registry so prompts can be wired to it.
Re-running on an existing repo updates repo-level fields (branch, sensitivity, enabled) without touching existing prompt bindings.
Use dryRun:true first when unsure — it returns the unified diff without committing.
Example: { repo: "org/my-repo", sensitivity: "low", dryRun: true }`,
    {
      repo: z.string().min(1),
      branch: z.string().optional(),
      sensitivity: z.enum(['low', 'medium', 'high']).optional(),
      enabled: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    },
    async (args) => {
      try {
        const { addTarget } = await import('@hub/prompts/edit')
        const result = await addTarget(args)
        return text(JSON.stringify(result, null, 2))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    'hub.registry.wire',
    `Wire a prompt to a repo with a trigger (cron:..., pr.opened, etc).
Re-running with the same (repo, promptId, trigger) updates the binding — it is idempotent.
Use dryRun:true to preview. Example: { repo: "org/my-repo", promptId: "daily-review", trigger: "cron:0 9 * * 1-5" }`,
    {
      repo: z.string().min(1),
      promptId: z.string().min(1),
      trigger: z.string().min(1),
      when: z.string().optional(),
      args: z.record(z.unknown()).optional(),
      enabled: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    },
    async (args) => {
      try {
        const { wirePrompt } = await import('@hub/prompts/edit')
        const result = await wirePrompt(args)
        return text(JSON.stringify(result, null, 2))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    'hub.registry.remove',
    `Remove a repo block or a specific prompt binding from hub-registry.
Omit promptId to remove the entire repo block. Supply promptId+trigger to remove only that binding. No-op if not found.
Example: { repo: "org/my-repo", promptId: "daily-review", trigger: "cron:0 9 * * 1-5", dryRun: true }`,
    {
      repo: z.string().min(1),
      promptId: z.string().optional(),
      trigger: z.string().optional(),
      dryRun: z.boolean().optional(),
    },
    async (args) => {
      try {
        const { removeEntry } = await import('@hub/prompts/edit')
        const result = await removeEntry(args)
        return text(JSON.stringify(result, null, 2))
      } catch (e) {
        return err(e)
      }
    },
  )

  server.tool(
    'hub.registry.list',
    `List prompt targets currently wired in the Hub DB (reflects last sync).
Args for high-sensitivity prompts are redacted. Filter by repo: { repo: "org/my-repo" }.`,
    { repo: z.string().optional() },
    async ({ repo }) => {
      try {
        const db = getDb()
        const rows = await db
          .select({
            id: promptTargets.id,
            repo: promptTargets.repo,
            promptId: promptTargets.promptId,
            trigger: promptTargets.trigger,
            enabled: promptTargets.enabled,
            lastRunAt: promptTargets.lastRunAt,
            args: promptTargets.args,
            sensitivity: prompts.sensitivity,
          })
          .from(promptTargets)
          .leftJoin(prompts, eq(promptTargets.promptId, prompts.id))
          .all()

        const filtered = repo ? rows.filter((r) => r.repo === repo) : rows
        const out = filtered.map(({ sensitivity, ...r }) => ({
          ...r,
          args: sensitivity === 'high' ? '[redacted]' : r.args,
        }))
        return text(JSON.stringify(out, null, 2))
      } catch (e) {
        return err(e)
      }
    },
  )

  return server
}
