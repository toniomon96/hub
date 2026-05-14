import { z } from './z.js'

export const Settings = z
  .object({
    version: z.string(),
    timezone: z.string(),
    port: z.number().int(),
    host: z.string(),
    vaultPath: z.string().nullable(),
    dbPath: z.string(),
    logLevel: z.string(),
    models: z.object({
      default: z.string(),
      localTrivial: z.string(),
      localPrivate: z.string(),
      localFallback: z.string(),
    }),
    dailyUsdCap: z.number(),
    ollamaUrl: z.string(),
    integrations: z.record(z.string(), z.boolean()),
  })
  .openapi('Settings')
export type Settings = z.infer<typeof Settings>
