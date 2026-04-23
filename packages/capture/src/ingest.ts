import { getDb } from '@hub/db'
import { captures } from '@hub/db/schema'
import {
  newId,
  contentHash,
  getLogger,
  loadEnv,
  isQuietHour,
  type CaptureSource,
} from '@hub/shared'
import { eq } from 'drizzle-orm'
import { classify } from './classify.js'
import { fileToInbox } from './inbox.js'

const log = getLogger('ingest')

// Hard cap: no single capture should dominate the context window.
const CAPTURE_TEXT_MAX_CHARS = 8_000

/**
 * Strip common prompt injection patterns from externally-sourced capture text.
 * Applied before any model call so injected instructions never reach the LLM.
 */
export function sanitizeForPrompt(text: string): string {
  return text
    .replace(/ignore\s+(previous|all|above)\s+instructions?/gi, '[redacted]')
    .replace(/^(system|assistant|user):\s*/gim, '[redacted-role]: ')
    .replace(/<\|im_(start|end)\|>/gi, '')
    .slice(0, CAPTURE_TEXT_MAX_CHARS)
}

export interface IngestArgs {
  source: CaptureSource
  text: string
  rawContentRef: string
  receivedAt?: number
  /**
   * Run the Ollama classifier after insert. Default `true` in production;
   * tests that don't want to reach Ollama should pass `false`.
   * Classifier failure NEVER blocks ingest — the row just stays at
   * `status='received'` until something re-processes it.
   */
  /**
   * Append to the Obsidian inbox after successful classification.
   * Default `true`. Skipped automatically when `OBSIDIAN_VAULT_PATH` is
   * unset or sensitivity=high. Disabled in tests that don't want filesystem
   * writes. No-op when classification is skipped or fails.
   */
  fileToInbox?: boolean
  classify?: boolean
}

export interface IngestResult {
  /**
   * Whether a markdown file was written to the Obsidian inbox.
   * `false` when skipped (caller opted out, vault not configured, sensitivity=high,
   * or write failed). Undefined when classification did not run.
   */
  filed?: boolean
  id: string
  isDuplicate: boolean
  /**
   * Whether the classifier ran and persisted. `false` when skipped
   * (caller opted out OR classifier threw). Undefined on dedup.
   */
  classified?: boolean
}

/**
 * Idempotent capture ingestion. Dedup by content hash so a webhook retry
 * doesn't create a second row. Async because the underlying driver
 * (node:sqlite via drizzle-orm/sqlite-proxy) is async-shaped.
 *
 * When `classify` is not false, the Ollama classifier is invoked after
 * insert and its output is persisted on the same row. A classifier failure
 * is logged at warn level and leaves the row at `status='received'` so
 * it can be retried by a sweep job later. We never throw from ingest for
 * a classifier error — capture-first, enrich-later.
 */
export async function ingest(args: IngestArgs): Promise<IngestResult> {
  const db = getDb()
  const hash = contentHash(args.text)
  const existing = await db.select().from(captures).where(eq(captures.contentHash, hash)).get()
  if (existing) {
    log.info({ hash, existingId: existing.id, source: args.source }, 'duplicate capture')
    return { id: existing.id, isDuplicate: true }
  }

  const id = newId()
  await db
    .insert(captures)
    .values({
      id,
      source: args.source,
      receivedAt: args.receivedAt ?? Date.now(),
      contentHash: hash,
      rawContentRef: args.rawContentRef,
      status: 'received',
    })
    .run()

  log.info({ id, source: args.source, hash }, 'capture ingested')

  if (args.classify === false) {
    return { id, isDuplicate: false, classified: false }
  }

  // Sanitize before any model call — strips injection patterns from external sources.
  const safeText = sanitizeForPrompt(args.text)

  try {
    const env = loadEnv()
    const result = await classify({ text: safeText })
    await db
      .update(captures)
      .set({
        classifiedDomain: result.domain,
        classifiedType: result.type,
        confidence: result.confidence,
        entitiesJson: JSON.stringify(result.entities),
        actionItemsJson: JSON.stringify(result.actionItems),
        decisionsJson: JSON.stringify(result.decisions),
        modelUsed: `ollama:${env.HUB_LOCAL_MODEL_TRIVIAL}`,
        status: 'classified',
      })
      .where(eq(captures.id, id))
      .run()
    log.info(
      { id, domain: result.domain, type: result.type, confidence: result.confidence },
      'capture classified',
    )

    // Dispatch process-capture if there are action items, we're not in quiet hours,
    // and the hub-prompts repo is configured.
    if (
      result.actionItems.length > 0 &&
      !isQuietHour(env.HUB_QUIET_HOURS) &&
      env.HUB_PROMPTS_REPO_URL
    ) {
      // Fire-and-forget — capture storage is never blocked on dispatch.
      dispatchProcessCapture(id).catch((err) => {
        log.warn({ id, err: String(err) }, 'process-capture dispatch failed')
      })
    }

    if (args.fileToInbox === false) {
      return { id, isDuplicate: false, classified: true, filed: false }
    }

    const inboxResult = await fileToInbox({
      captureId: id,
      text: safeText,
      source: args.source,
      domain: result.domain,
      type: result.type,
      contentHash: hash,
      summary: result.summary,
    })
    return { id, isDuplicate: false, classified: true, filed: inboxResult.filed }
  } catch (err) {
    log.warn(
      { id, err: err instanceof Error ? err.message : String(err) },
      'classify failed; capture left at status=received',
    )
    return { id, isDuplicate: false, classified: false }
  }
}

async function dispatchProcessCapture(captureId: string): Promise<void> {
  const { dispatchPromptRun } = await import('@hub/prompts/dispatcher')
  const env = loadEnv()
  // Extract the repo slug from HUB_PROMPTS_REPO_URL (e.g. "https://github.com/user/hub-prompts")
  const repoMatch = env.HUB_PROMPTS_REPO_URL!.match(/github\.com\/(.+?)(?:\.git)?$/)
  const repo = repoMatch ? repoMatch[1]! : ''
  if (!repo) {
    log.warn(
      { captureId },
      'could not extract repo slug from HUB_PROMPTS_REPO_URL; skipping dispatch',
    )
    return
  }
  await dispatchPromptRun({
    promptId: 'process-capture',
    repo,
    args: { captureId },
    trigger: 'event',
  })
  log.info({ captureId, repo }, 'process-capture dispatched')
}
