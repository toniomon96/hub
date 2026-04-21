/**
 * API contracts shared between `@hub/server` and `@hub/web`/`@hub/cli`.
 *
 * Single source of truth for every HTTP shape. Server uses these with
 * `@hono/zod-openapi` to emit an OpenAPI document at `/api/openapi.json`;
 * clients import the zod schemas / TS types directly.
 *
 * The `.openapi('Name')` extension is applied in `./z.js` (imported by
 * every contract module), so these schemas stay usable from any entry.
 */
export { z } from './z.js'
export * from './primitives.js'
export * from './status.js'
export * from './captures.js'
export * from './runs.js'
export * from './briefings.js'
export * from './ask.js'
export * from './settings.js'
