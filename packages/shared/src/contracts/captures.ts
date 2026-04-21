import { z } from './z.js'
import { CaptureSource } from '../types.js'
import { EpochMs, IdString } from './primitives.js'

export const CaptureRow = z
  .object({
    id: IdString,
    source: z.string(),
    receivedAt: EpochMs,
    classifiedDomain: z.string().nullable(),
    classifiedType: z.string().nullable(),
    status: z.string(),
    rawContentRef: z.string(),
  })
  .openapi('CaptureRow')
export type CaptureRow = z.infer<typeof CaptureRow>

export const CapturesList = z.object({ captures: z.array(CaptureRow) }).openapi('CapturesList')
export type CapturesList = z.infer<typeof CapturesList>

export const EntitiesArr = z.array(
  z.object({ name: z.string().optional(), type: z.string().optional() }),
)
export const ActionsArr = z.array(
  z.object({ text: z.string().optional(), due: z.string().optional() }),
)
export const DecisionsArr = z.array(z.object({ text: z.string().optional() }))

export const CaptureDetail = CaptureRow.extend({
  contentHash: z.string(),
  confidence: z.number().nullable(),
  modelUsed: z.string().nullable(),
  errorMessage: z.string().nullable(),
  entities: EntitiesArr,
  actionItems: ActionsArr,
  decisions: DecisionsArr,
  dispatchedTo: z.array(z.string()),
  body: z.string().nullable(),
}).openapi('CaptureDetail')
export type CaptureDetail = z.infer<typeof CaptureDetail>

export const CaptureCreateRequest = z
  .object({
    text: z.string().min(1),
    source: CaptureSource.optional(),
  })
  .openapi('CaptureCreateRequest')
export type CaptureCreateRequest = z.infer<typeof CaptureCreateRequest>

export const CaptureCreateResponse = z
  .object({ id: IdString, isDuplicate: z.boolean() })
  .openapi('CaptureCreateResponse')
export type CaptureCreateResponse = z.infer<typeof CaptureCreateResponse>
