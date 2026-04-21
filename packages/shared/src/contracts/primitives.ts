import { z } from './z.js'

/**
 * Re-exported primitives used across API contracts. Keep these in one place
 * so OpenAPI refs stay stable and the generated client sees the same shapes
 * the server emits.
 */

export const ErrorEnvelope = z
  .object({
    error: z.string().openapi({ example: 'bad_request' }),
  })
  .openapi('ErrorEnvelope')
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>

/** ULID-ish; 26 chars base32. We don't validate strictly to allow older test ids. */
export const IdString = z.string().min(1).openapi({ example: '01J8R1X3E7...' })

/** Unix epoch ms. */
export const EpochMs = z.number().int().openapi({ example: 1745200000000 })

/** ISO date YYYY-MM-DD. */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .openapi({ example: '2026-04-21' })
