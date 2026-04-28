import { z } from './z.js'
import { IdString } from './primitives.js'
import { AskMode, LifeArea } from '../types.js'

const ScopeName = z.enum(['knowledge', 'workspace', 'tasks', 'code', 'system'])
const ScopeDecision = z.object({
  scope: ScopeName,
  reason: z.string(),
})

export const AskRequest = z
  .object({
    input: z.string().min(1),
    forceLocal: z.boolean().optional(),
    mode: AskMode.optional(),
    lifeArea: LifeArea.optional(),
    projectRef: z.string().min(1).optional(),
    requestedScopes: z.array(ScopeName).max(5).optional(),
    governorDomain: z.string().min(1).optional(),
    /** Legacy compatibility input — mapped to lifeArea at the API edge. */
    domain: z.string().min(1).optional(),
  })
  .openapi('AskRequest')
export type AskRequest = z.infer<typeof AskRequest>

export const AskResponse = z
  .object({
    runId: IdString,
    output: z.string(),
    modelUsed: z.string(),
    status: z.enum(['success', 'error', 'partial']),
    inputTokens: z.number().int().optional(),
    outputTokens: z.number().int().optional(),
    costUsd: z.number().optional(),
    appliedMode: AskMode.optional(),
    lifeArea: LifeArea.optional(),
    projectRef: z.string().optional(),
    governorDomain: z.string().optional(),
    appliedScopes: z.array(ScopeName).optional(),
    deniedScopes: z.array(ScopeDecision).optional(),
    authority: z.enum(['suggest', 'draft', 'act']).optional(),
  })
  .openapi('AskResponse')
export type AskResponse = z.infer<typeof AskResponse>

/**
 * Discriminated union of events emitted on the POST /api/ask/stream SSE
 * channel. Each event is sent as a single SSE frame with `event:` set to
 * the discriminator and `data:` the JSON payload.
 *
 * Event order guarantees:
 *   1. exactly one `meta` frame first,
 *   2. zero-or-more `token` frames,
 *   3. exactly one of `final` | `error` last.
 */
export const AskStreamMeta = z
  .object({
    runId: IdString,
    modelUsed: z.string(),
    appliedMode: AskMode.optional(),
    lifeArea: LifeArea.optional(),
    projectRef: z.string().optional(),
    governorDomain: z.string().optional(),
    appliedScopes: z.array(ScopeName).optional(),
    deniedScopes: z.array(ScopeDecision).optional(),
    authority: z.enum(['suggest', 'draft', 'act']).optional(),
  })
  .openapi('AskStreamMeta')
export type AskStreamMeta = z.infer<typeof AskStreamMeta>

export const AskStreamToken = z
  .object({
    text: z.string(),
  })
  .openapi('AskStreamToken')
export type AskStreamToken = z.infer<typeof AskStreamToken>

export const AskStreamFinal = AskResponse.openapi('AskStreamFinal')
export type AskStreamFinal = z.infer<typeof AskStreamFinal>

export const AskStreamError = z
  .object({
    message: z.string(),
    runId: IdString.optional(),
  })
  .openapi('AskStreamError')
export type AskStreamError = z.infer<typeof AskStreamError>

export type AskStreamEvent =
  | { event: 'meta'; data: AskStreamMeta }
  | { event: 'token'; data: AskStreamToken }
  | { event: 'final'; data: AskStreamFinal }
  | { event: 'error'; data: AskStreamError }
