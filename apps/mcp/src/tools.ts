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

  return server
}
