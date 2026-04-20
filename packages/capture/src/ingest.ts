import { getDb } from '@hub/db'
import { captures } from '@hub/db/schema'
import { newId, contentHash, getLogger, loadEnv, type CaptureSource } from '@hub/shared'
import { eq } from 'drizzle-orm'
import { classify } from './classify.js'

const log = getLogger('ingest')

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
  classify?: boolean
}

export interface IngestResult {
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

  try {
    const env = loadEnv()
    const result = await classify({ text: args.text })
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
    return { id, isDuplicate: false, classified: true }
  } catch (err) {
    log.warn(
      { id, err: err instanceof Error ? err.message : String(err) },
      'classify failed; capture left at status=received',
    )
    return { id, isDuplicate: false, classified: false }
  }
}
