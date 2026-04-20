import { getDb } from '@hub/db'
import { captures } from '@hub/db/schema'
import { newId, contentHash, getLogger, type CaptureSource } from '@hub/shared'
import { eq } from 'drizzle-orm'

const log = getLogger('ingest')

export interface IngestArgs {
  source: CaptureSource
  text: string
  rawContentRef: string
  receivedAt?: number
}

export interface IngestResult {
  id: string
  isDuplicate: boolean
}

/**
 * Idempotent capture ingestion. Dedup by content hash so a webhook retry
 * doesn't create a second row. Async because the underlying driver
 * (node:sqlite via drizzle-orm/sqlite-proxy) is async-shaped.
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
  return { id, isDuplicate: false }
}
