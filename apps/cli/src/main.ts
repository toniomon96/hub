import { Command } from 'commander'
import kleur from 'kleur'
import { run } from '@hub/agent-runtime'
import { getDb } from '@hub/db'
import { runs, captures, agentLocks } from '@hub/db/schema'
import { sql } from 'drizzle-orm'
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
  .action(async (opts) => {
    const result = await run(
      { input: `Generate briefing for ${opts.date ?? 'today'}`, source: 'cli', forceLocal: false },
      {
        agentName: 'nightly-brief',
        scopes: ['knowledge', 'workspace', 'tasks'],
        permissionTier: 'R1',
      },
    )
    console.log(kleur.cyan(`run ${result.runId} → ${result.modelUsed}`))
    console.log(result.output)
  })

program
  .command('ask <query...>')
  .description('One-shot query, auto-routed')
  .option('--local', 'force local SLM (privacy)', false)
  .action(async (queryParts: string[], opts) => {
    const input = queryParts.join(' ')
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

program.parseAsync().catch((err) => {
  console.error(kleur.red('error:'), err.message)
  process.exit(1)
})
