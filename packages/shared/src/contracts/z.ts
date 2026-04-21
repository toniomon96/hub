/**
 * Single entry point for the zod instance used across API contracts. The
 * `extendZodWithOpenApi` call teaches `z` about the `.openapi()` metadata
 * method; every contract file imports `z` from here so the patch is applied
 * before any schema calls `.openapi()`. Importing `zod` directly would not
 * guarantee the patch has run yet.
 */
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

extendZodWithOpenApi(z)

export { z }
