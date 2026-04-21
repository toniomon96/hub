import { z } from './z.js'
import { EpochMs, IdString, IsoDate } from './primitives.js'

export const BriefingRow = z
  .object({
    date: IsoDate,
    generatedAt: EpochMs,
    runId: IdString,
    obsidianRef: z.string(),
    rating: z.number().int().nullable(),
  })
  .openapi('BriefingRow')
export type BriefingRow = z.infer<typeof BriefingRow>

export const BriefingsList = z.object({ briefings: z.array(BriefingRow) }).openapi('BriefingsList')
export type BriefingsList = z.infer<typeof BriefingsList>

export const BriefingDetail = BriefingRow.extend({
  notes: z.string().nullable(),
  body: z.string().nullable(),
}).openapi('BriefingDetail')
export type BriefingDetail = z.infer<typeof BriefingDetail>
