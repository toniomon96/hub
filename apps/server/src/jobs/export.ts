import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { getDb } from '@hub/db'
import { captures, briefings } from '@hub/db/schema'
import { getLogger, notify, loadEnv } from '@hub/shared'
import { gte } from 'drizzle-orm'

const log = getLogger('export')

const EXPORT_DIR = process.env['HUB_EXPORT_DIR'] ?? '/data/exports'
const CONTEXT_PATH = process.env['HUB_CONTEXT_PATH'] ?? '/data/context.md'

function subDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - days)
  return d
}

export async function runWeeklyExport(): Promise<void> {
  const db = getDb()
  const date = new Date().toISOString().slice(0, 10)!
  const dir = EXPORT_DIR

  mkdirSync(dir, { recursive: true })

  const since = subDays(new Date(), 7)
  const sinceMs = since.getTime()

  // Captures → JSONL
  const caps = await db.select().from(captures).where(gte(captures.receivedAt, sinceMs)).all()
  writeFileSync(
    join(dir, `captures-${date}.jsonl`),
    caps.map((c) => JSON.stringify(c)).join('\n'),
    'utf8',
  )

  // Context snapshot
  if (existsSync(CONTEXT_PATH)) {
    copyFileSync(CONTEXT_PATH, join(dir, `context-${date}.md`))
  }

  // Briefings → markdown
  const briefs = await db.select().from(briefings).where(gte(briefings.generatedAt, sinceMs)).all()
  writeFileSync(
    join(dir, `briefs-${date}.md`),
    briefs.map((b) => b.body ?? '').join('\n\n---\n\n'),
    'utf8',
  )

  log.info({ date, dir, caps: caps.length, briefs: briefs.length }, 'weekly export complete')
}

export interface ExportFileMeta {
  name: string
  sizeBytes: number
  createdAt: string
}

export function listExports(): ExportFileMeta[] {
  if (!existsSync(EXPORT_DIR)) return []
  return readdirSync(EXPORT_DIR)
    .filter((f) => f.endsWith('.jsonl') || f.endsWith('.md'))
    .map((name) => {
      const st = statSync(join(EXPORT_DIR, name))
      return { name, sizeBytes: st.size, createdAt: st.birthtime.toISOString() }
    })
    .sort((a, b) => b.name.localeCompare(a.name))
}

export function exportFilePath(name: string): string {
  const base = resolve(EXPORT_DIR)
  const resolved = resolve(base, name)
  if (!resolved.startsWith(base + sep)) {
    throw new Error('invalid export filename')
  }
  return resolved
}

export async function runWeeklyExportSafe(): Promise<void> {
  const env = loadEnv()
  try {
    await runWeeklyExport()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ err: msg }, 'weekly export failed')
    if (env.NTFY_TOPIC) {
      await notify({
        title: 'hub: weekly export failed',
        body: msg,
        priority: 'high',
        tags: ['warning', 'hub'],
      }).catch(() => undefined)
    }
  }
}
