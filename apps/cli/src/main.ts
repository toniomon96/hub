import { Command } from 'commander'
import kleur from 'kleur'
import { run } from '@hub/agent-runtime'
import { getDb } from '@hub/db'
import { runs, captures, agentLocks } from '@hub/db/schema'
import { sql, desc, and, gte, eq, like } from 'drizzle-orm'
import { runDoctor, printDoctorReport } from './doctor.js'

const program = new Command()
  .name('hub')
  .description('Personal AI operating layer')
  .version('0.3.0')

program
  .command('brief')
  .description("Generate today's briefing (or fetch the cached one)")
  .option('-d, --date <YYYY-MM-DD>', 'specific date')
  .option('--regenerate', 'force regeneration', false)
  .option('--local', 'skip the Agent SDK; local-only summary', false)
  .action(async (opts) => {
    const { runBrief } = await import('@hub/agent-runtime/brief')
    const result = await runBrief({
      date: opts.date,
      regenerate: !!opts.regenerate,
      localOnly: !!opts.local,
      source: 'cli',
    })
    console.log(
      kleur.cyan(
        `${result.cached ? 'cached' : 'generated'} brief for ${result.date} (run ${result.runId}, ${result.status})`,
      ),
    )
    if (result.path) console.log(kleur.gray(result.path))
    if (result.output) console.log('\n' + result.output)
  })

program
  .command('ask <query...>')
  .description('One-shot query, auto-routed')
  .option('--local', 'force local SLM (privacy)', false)
  .option('--stream', 'stream tokens as they arrive (stdout)', false)
  .action(async (queryParts: string[], opts) => {
    const input = queryParts.join(' ')
    if (opts.stream) {
      const { runStream } = await import('@hub/agent-runtime')
      const ctrl = new AbortController()
      const onSig = () => ctrl.abort()
      process.on('SIGINT', onSig)
      let modelUsed = ''
      let runId = ''
      try {
        for await (const ev of runStream(
          { input, source: 'cli', forceLocal: !!opts.local },
          { agentName: 'ask-oneshot', scopes: ['knowledge', 'tasks'], signal: ctrl.signal },
        )) {
          if (ev.type === 'meta') {
            modelUsed = ev.modelUsed
            runId = ev.runId
            console.error(kleur.cyan(`run ${runId} → ${modelUsed}`))
          } else if (ev.type === 'token') {
            process.stdout.write(ev.text)
          } else if (ev.type === 'final') {
            process.stdout.write('\n')
          } else {
            console.error(kleur.red(`\nerror: ${ev.message}`))
            process.exitCode = 1
          }
        }
      } finally {
        process.off('SIGINT', onSig)
      }
      return
    }
    const result = await run(
      { input, source: 'cli', forceLocal: !!opts.local },
      { agentName: 'ask-oneshot', scopes: ['knowledge', 'tasks'] },
    )
    console.log(kleur.cyan(`run ${result.runId} → ${result.modelUsed}`))
    console.log(result.output)
  })

program
  .command('status')
  .description('Show DB stats, recent runs, and active leases')
  .action(async () => {
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
    const leases = await db.select().from(agentLocks).all()
    const recent = await db
      .select({
        id: runs.id,
        agent: runs.agentName,
        model: runs.modelUsed,
        status: runs.status,
        startedAt: runs.startedAt,
      })
      .from(runs)
      .orderBy(sql`started_at desc`)
      .limit(5)
      .all()

    console.log(kleur.bold('hub v0.3.0'))
    console.log(`  captures: ${captureCount}`)
    console.log(`  runs:     ${runCount}`)
    console.log(`  leases:   ${leases.length}`)
    if (recent.length) {
      console.log(kleur.bold('\nrecent runs'))
      for (const r of recent) {
        const when = new Date(r.startedAt).toISOString()
        console.log(
          `  ${kleur.gray(when)}  ${r.agent.padEnd(16)}  ${r.model.padEnd(36)}  ${r.status}`,
        )
      }
    }
  })

program
  .command('migrate')
  .description('Apply pending DB migrations')
  .action(async () => {
    const { migrate } = await import('@hub/db/migrate')
    migrate()
    console.log(kleur.green('migrations applied'))
  })

program
  .command('doctor')
  .description('Preflight: verify env, DB, migrations, and integration reachability')
  .action(async () => {
    const { results, ok } = await runDoctor()
    printDoctorReport(results, ok)
    if (!ok) process.exit(1)
  })

program
  .command('capture <text...>')
  .description('Quick capture from the CLI')
  .action(async (parts: string[]) => {
    const { ingest } = await import('@hub/capture/ingest')
    const text = parts.join(' ')
    const result = await ingest({ source: 'cli', text, rawContentRef: `cli:${Date.now()}` })
    console.log(kleur.cyan(result.isDuplicate ? `dup → ${result.id}` : `captured ${result.id}`))
  })

// ── hub prompt * ──────────────────────────────────────────────────────────────

const promptCmd = new Command('prompt').description('Prompt orchestration')
program.addCommand(promptCmd)

promptCmd
  .command('sync')
  .description('Clone hub-prompts and hub-registry, upsert into DB')
  .option('--branch <name>', 'branch to clone', 'main')
  .action(async (opts: { branch: string }) => {
    const { syncPrompts } = await import('@hub/prompts/sync')
    const { registerScheduledPromptJobs } = await import('@hub/prompts/schedule')
    const result = await syncPrompts({ branch: opts.branch })
    console.log(
      kleur.green(
        `sync complete: ${result.promptsUpserted} prompts, ${result.targetsUpserted} targets (+${result.targetsRemoved} removed)`,
      ),
    )
    if (result.errors.length) {
      console.log(kleur.yellow(`parse errors:`))
      for (const e of result.errors) console.log(`  ${e.file}: ${e.error}`)
    }
    await registerScheduledPromptJobs()
  })

promptCmd
  .command('run <promptId> <repo>')
  .description('Manually dispatch a prompt run')
  .option('--branch <name>', 'target repo branch', 'main')
  .option('--arg <kv...>', 'key=value args (repeatable)')
  .action(async (promptId: string, repo: string, opts: { branch: string; arg?: string[] }) => {
    const { dispatchPromptRun } = await import('@hub/prompts/dispatcher')
    const args: Record<string, string> = {}
    for (const kv of opts.arg ?? []) {
      const [k, ...rest] = kv.split('=')
      if (k) args[k] = rest.join('=')
    }
    const result = await dispatchPromptRun({
      promptId,
      repo,
      branch: opts.branch,
      args,
      trigger: 'manual',
    })
    console.log(kleur.cyan(`run ${result.runId}`))
  })

promptCmd
  .command('list')
  .description('List synced prompts')
  .action(async () => {
    const { getDb: db } = await import('@hub/db')
    const { prompts } = await import('@hub/db/schema')
    const rows = await db()
      .select({
        id: prompts.id,
        version: prompts.version,
        title: prompts.title,
        sensitivity: prompts.sensitivity,
        complexity: prompts.complexity,
      })
      .from(prompts)
      .all()
    if (!rows.length) {
      console.log(kleur.gray('no prompts synced'))
      return
    }
    for (const r of rows) {
      console.log(
        `  ${kleur.cyan(r.id.padEnd(32))} v${r.version}  ${r.sensitivity.padEnd(8)} ${r.complexity.padEnd(10)}  ${r.title}`,
      )
    }
  })

promptCmd
  .command('targets')
  .description('List prompt targets')
  .option('--repo <slug>', 'filter by repo')
  .action(async (opts: { repo?: string }) => {
    const { getDb: db } = await import('@hub/db')
    const { promptTargets } = await import('@hub/db/schema')
    const allTargets = await db().select().from(promptTargets).all()
    const filtered = opts.repo ? allTargets.filter((t) => t.repo === opts.repo) : allTargets
    if (!filtered.length) {
      console.log(kleur.gray('no targets'))
      return
    }
    for (const t of filtered) {
      const last = t.lastRunAt ? new Date(t.lastRunAt).toISOString() : 'never'
      console.log(
        `  ${kleur.cyan(t.repo.padEnd(32))} ${t.promptId.padEnd(24)} ${t.trigger.padEnd(32)} last:${last}`,
      )
    }
  })

promptCmd
  .command('results')
  .description('Show prompt run history')
  .option('--repo <slug>', 'filter by target repo')
  .option('--prompt-id <id>', 'filter by prompt id')
  .option('--since <iso>', 'only show runs after this ISO date')
  .option('--limit <n>', 'max rows', '20')
  .action(async (opts: { repo?: string; promptId?: string; since?: string; limit: string }) => {
    const db = getDb()
    const limit = parseInt(opts.limit, 10)
    const conditions = [sql`${runs.promptId} IS NOT NULL`]
    if (opts.repo) conditions.push(eq(runs.targetRepo, opts.repo))
    if (opts.promptId) conditions.push(eq(runs.promptId, opts.promptId))
    if (opts.since) conditions.push(gte(runs.startedAt, new Date(opts.since).getTime()))
    const rows = await db
      .select({
        id: runs.id,
        promptId: runs.promptId,
        targetRepo: runs.targetRepo,
        status: runs.status,
        startedAt: runs.startedAt,
      })
      .from(runs)
      .where(and(...conditions))
      .orderBy(desc(runs.startedAt))
      .limit(limit)
      .all()
    if (!rows.length) {
      console.log(kleur.gray('no results'))
      return
    }
    for (const r of rows) {
      const when = new Date(r.startedAt).toISOString()
      console.log(
        `  ${kleur.gray(when)}  ${(r.promptId ?? '').padEnd(24)}  ${(r.targetRepo ?? '').padEnd(24)}  ${r.status}  ${r.id}`,
      )
    }
  })

promptCmd
  .command('schedule')
  .description('Show enabled cron prompt schedules from the DB')
  .action(async () => {
    const { promptTargets } = await import('@hub/db/schema')
    const db = getDb()
    const cronTargets = await db
      .select({
        promptId: promptTargets.promptId,
        repo: promptTargets.repo,
        trigger: promptTargets.trigger,
      })
      .from(promptTargets)
      .where(and(like(promptTargets.trigger, 'cron:%'), eq(promptTargets.enabled, 1)))
      .all()
    if (!cronTargets.length) {
      console.log(kleur.gray('no scheduled cron targets configured'))
      return
    }
    const byExpr = new Map<string, Array<{ promptId: string; repo: string }>>()
    for (const t of cronTargets) {
      const expr = t.trigger.slice('cron:'.length)
      const group = byExpr.get(expr) ?? []
      group.push({ promptId: t.promptId, repo: t.repo })
      byExpr.set(expr, group)
    }
    for (const [expr, targets] of byExpr) {
      console.log(kleur.cyan(expr))
      for (const t of targets) console.log(`  ${t.promptId} → ${t.repo}`)
    }
  })

// ─── Registry management ────────────────────────────────────────────────────

function parseKv(kv: string): [string, unknown] {
  const eq = kv.indexOf('=')
  if (eq < 0) throw new Error(`--arg must be key=value, got: ${kv}`)
  const key = kv.slice(0, eq)
  const raw = kv.slice(eq + 1)
  try {
    return [key, JSON.parse(raw)]
  } catch {
    return [key, raw]
  }
}

function printDiff(diff: string): void {
  if (!diff) {
    console.log(kleur.gray('(no changes)'))
    return
  }
  for (const line of diff.split('\n')) {
    if (line.startsWith('+')) console.log(kleur.green(line))
    else if (line.startsWith('-')) console.log(kleur.red(line))
    else console.log(kleur.gray(line))
  }
}

const registryCmd = new Command('registry').description('Registry management')
program.addCommand(registryCmd)

registryCmd
  .command('add <repo>')
  .description('Add a repo to the registry (or update its repo-level fields)')
  .option('--sensitivity <level>', 'low | medium | high')
  .option('--branch <name>', 'default branch', 'main')
  .option('--dry-run', 'preview change without committing')
  .action(
    async (repo: string, opts: { sensitivity?: string; branch: string; dryRun?: boolean }) => {
      const { addTarget } = await import('@hub/prompts/edit')
      try {
        const result = await addTarget({
          repo,
          branch: opts.branch,
          ...(opts.sensitivity !== undefined
            ? { sensitivity: opts.sensitivity as 'low' | 'medium' | 'high' }
            : {}),
          dryRun: opts.dryRun,
        })
        printDiff(result.diff)
        if (result.committed) {
          console.log(
            kleur.green(`committed ${result.commitSha?.slice(0, 8)} → ${result.pushedTo}`),
          )
          if (result.syncSummary) {
            console.log(
              kleur.gray(
                `synced: ${result.syncSummary.targetsUpserted} targets upserted, ${result.syncSummary.targetsRemoved} removed`,
              ),
            )
          }
        }
      } catch (err) {
        console.error(kleur.red('error:'), err instanceof Error ? err.message : String(err))
        process.exit(2)
      }
    },
  )

registryCmd
  .command('wire <repo> <promptId>')
  .description('Wire a prompt to a repo with a trigger')
  .requiredOption('--trigger <spec>', 'cron:... | pr.opened | etc')
  .option('--when <expr>', 'when_expr filter expression')
  .option('--arg <kv...>', 'key=value args (repeatable; value is JSON-coerced)')
  .option('--dry-run', 'preview change without committing')
  .action(
    async (
      repo: string,
      promptId: string,
      opts: { trigger: string; when?: string; arg?: string[]; dryRun?: boolean },
    ) => {
      const { wirePrompt } = await import('@hub/prompts/edit')
      const args: Record<string, unknown> = {}
      for (const kv of opts.arg ?? []) {
        const [k, v] = parseKv(kv)
        args[k] = v
      }
      try {
        const result = await wirePrompt({
          repo,
          promptId,
          trigger: opts.trigger,
          ...(opts.when !== undefined ? { when: opts.when } : {}),
          ...(Object.keys(args).length ? { args } : {}),
          dryRun: opts.dryRun,
        })
        printDiff(result.diff)
        if (result.committed) {
          console.log(
            kleur.green(`committed ${result.commitSha?.slice(0, 8)} → ${result.pushedTo}`),
          )
          if (result.syncSummary) {
            console.log(
              kleur.gray(
                `synced: ${result.syncSummary.targetsUpserted} targets upserted, ${result.syncSummary.targetsRemoved} removed`,
              ),
            )
          }
        }
      } catch (err) {
        console.error(kleur.red('error:'), err instanceof Error ? err.message : String(err))
        process.exit(2)
      }
    },
  )

registryCmd
  .command('remove <repo>')
  .description('Remove a repo block or a specific prompt binding')
  .option('--prompt <id>', 'remove only this prompt binding')
  .option('--trigger <spec>', 'with --prompt, remove only this specific trigger')
  .option('--dry-run', 'preview change without committing')
  .action(async (repo: string, opts: { prompt?: string; trigger?: string; dryRun?: boolean }) => {
    const { removeEntry } = await import('@hub/prompts/edit')
    try {
      const result = await removeEntry({
        repo,
        ...(opts.prompt !== undefined ? { promptId: opts.prompt } : {}),
        ...(opts.trigger !== undefined ? { trigger: opts.trigger } : {}),
        dryRun: opts.dryRun,
      })
      printDiff(result.diff)
      if (result.committed) {
        console.log(kleur.green(`committed ${result.commitSha?.slice(0, 8)} → ${result.pushedTo}`))
        if (result.syncSummary) {
          console.log(
            kleur.gray(
              `synced: ${result.syncSummary.targetsUpserted} targets upserted, ${result.syncSummary.targetsRemoved} removed`,
            ),
          )
        }
      }
    } catch (err) {
      console.error(kleur.red('error:'), err instanceof Error ? err.message : String(err))
      process.exit(2)
    }
  })

registryCmd
  .command('list')
  .description('List prompt targets wired in the local DB')
  .option('--repo <slug>', 'filter by repo slug')
  .action(async (opts: { repo?: string }) => {
    const { promptTargets, prompts } = await import('@hub/db/schema')
    const db = getDb()
    const rows = await db
      .select({
        repo: promptTargets.repo,
        promptId: promptTargets.promptId,
        trigger: promptTargets.trigger,
        enabled: promptTargets.enabled,
        lastRunAt: promptTargets.lastRunAt,
        sensitivity: prompts.sensitivity,
      })
      .from(promptTargets)
      .leftJoin(prompts, eq(promptTargets.promptId, prompts.id))
      .all()
    const filtered = opts.repo ? rows.filter((r) => r.repo === opts.repo) : rows
    if (!filtered.length) {
      console.log(kleur.gray('no targets'))
      return
    }
    for (const r of filtered) {
      const last = r.lastRunAt ? new Date(r.lastRunAt).toISOString() : 'never'
      const enabledFlag = r.enabled ? '' : kleur.gray(' (disabled)')
      console.log(
        `  ${kleur.cyan(r.repo.padEnd(32))} ${r.promptId.padEnd(24)} ${r.trigger.padEnd(32)} last:${last}${enabledFlag}`,
      )
    }
  })

program.parseAsync().catch((err) => {
  console.error(kleur.red('error:'), err.message)
  process.exit(1)
})
