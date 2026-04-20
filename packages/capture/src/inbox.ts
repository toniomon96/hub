import { mkdir, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getDb } from '@hub/db'
import { captures } from '@hub/db/schema'
import { eq } from 'drizzle-orm'
import { loadEnv, getLogger, type CaptureSource } from '@hub/shared'
import { detectSensitivity } from '@hub/models/router'

const log = getLogger('inbox')

export interface FileToInboxArgs {
  captureId: string
  text: string
  source: CaptureSource
  domain: string
  type: string
  contentHash: string
  /** Summary from the classifier, used as the note body heading. */
  summary?: string
}

export interface FileToInboxResult {
  filed: boolean
  /** Absolute path written on disk. Undefined when not filed. */
  path?: string
  /** Why the write was skipped. Undefined on success. */
  reason?: 'not-configured' | 'sensitivity-high' | 'already-exists' | 'write-failed'
}

/**
 * Append a classified capture to the Obsidian inbox as a standalone markdown
 * file. Path + frontmatter follow `.claude/skills/obsidian-writer/SKILL.md`.
 *
 * Skips (and returns `{ filed: false, reason }`) when:
 *   - `OBSIDIAN_VAULT_PATH` is unset (fresh install / vault-less mode)
 *   - sensitivity=high — high-sens content stays in SQLite only
 *   - the target file already exists (idempotent on retries)
 *
 * A write failure is logged and reported via `reason`; it never throws, so
 * an inbox-write issue cannot poison the capture pipeline.
 */
export async function fileToInbox(args: FileToInboxArgs): Promise<FileToInboxResult> {
  const env = loadEnv()
  if (!env.OBSIDIAN_VAULT_PATH) {
    return { filed: false, reason: 'not-configured' }
  }

  const sensitivity = detectSensitivity(args.text, env.HUB_SENSITIVITY_PATTERNS)
  if (sensitivity === 'high') {
    log.info({ captureId: args.captureId }, 'inbox write skipped: sensitivity=high')
    return { filed: false, reason: 'sensitivity-high' }
  }

  const hash8 = args.contentHash.slice(0, 8)
  const date = formatDateInTz(new Date(), env.HUB_TIMEZONE)
  const inboxDir = resolve(env.OBSIDIAN_VAULT_PATH, 'inbox')
  const filename = `${date}-${hash8}.md`
  const outPath = join(inboxDir, filename)

  try {
    await mkdir(inboxDir, { recursive: true })

    // Idempotency: if a file with this hash already exists for today, skip.
    // Collisions are vanishingly rare; retries (webhook redelivery) are the
    // real reason we check.
    try {
      await access(outPath)
      log.debug({ outPath }, 'inbox file already exists, skipping')
      return { filed: true, path: outPath, reason: 'already-exists' }
    } catch {
      // expected — file does not exist, proceed
    }

    const body = renderMarkdown(args)
    await writeFile(outPath, body, { encoding: 'utf8' })

    // Record the dispatch on the capture row so `hub status` and later
    // reconciliation jobs know the note exists in Obsidian.
    const db = getDb()
    const row = await db
      .select({ dispatchedToJson: captures.dispatchedToJson })
      .from(captures)
      .where(eq(captures.id, args.captureId))
      .get()
    const existing: string[] = row?.dispatchedToJson ? JSON.parse(row.dispatchedToJson) : []
    const ref = `obsidian://inbox/${filename}`
    if (!existing.includes(ref)) existing.push(ref)
    await db
      .update(captures)
      .set({
        dispatchedToJson: JSON.stringify(existing),
        status: 'dispatched',
      })
      .where(eq(captures.id, args.captureId))
      .run()

    log.info({ captureId: args.captureId, outPath }, 'capture filed to inbox')
    return { filed: true, path: outPath }
  } catch (err) {
    log.warn(
      { captureId: args.captureId, err: err instanceof Error ? err.message : String(err) },
      'inbox write failed',
    )
    return { filed: false, reason: 'write-failed' }
  }
}

function renderMarkdown(args: FileToInboxArgs): string {
  const created = new Date().toISOString()
  const title = args.summary?.trim() || firstLine(args.text) || 'inbox capture'
  // Frontmatter order matches obsidian-writer skill.
  const fm = [
    '---',
    `created: ${created}`,
    `source: ${args.source}`,
    `domain: ${args.domain}`,
    `tags: [${args.domain}, inbox]`,
    `captureId: ${args.captureId}`,
    `type: ${args.type}`,
    `contentHash: ${args.contentHash}`,
    '---',
  ].join('\n')
  return `${fm}\n\n# ${escapeTitle(title)}\n\n${args.text.trim()}\n`
}

function firstLine(s: string): string {
  const line = s.split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
  return line.slice(0, 80)
}

function escapeTitle(s: string): string {
  return s.replace(/\r?\n/g, ' ').trim()
}

/** YYYY-MM-DD in the configured timezone, without a tz-database dep. */
function formatDateInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const m = parts.find((p) => p.type === 'month')?.value ?? '00'
  const day = parts.find((p) => p.type === 'day')?.value ?? '00'
  return `${y}-${m}-${day}`
}
