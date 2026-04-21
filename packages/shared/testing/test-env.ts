/**
 * Seed the environment variables that every test suite eventually needs in
 * order for `loadEnv()` (called by the lazy logger proxy and everything else
 * that imports from `@hub/shared`) to parse without throwing.
 *
 * Call from a top-level `beforeEach`; pair with `restoreTestEnv()` in
 * `afterEach` to avoid leaking into other suites.
 *
 * Keeps the number of scattered `process.env[...] = ...` lines down, and
 * ensures CI (which has no `.env`) and dev (which does) stay consistent.
 */

const DEFAULTS: Record<string, string> = {
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  HUB_SKIP_DOTENV: '1',
  HUB_LOG_LEVEL: 'fatal',
}

let snapshot: NodeJS.ProcessEnv | undefined

export function seedTestEnv(overrides: Record<string, string> = {}): void {
  snapshot = { ...process.env }
  for (const [k, v] of Object.entries({ ...DEFAULTS, ...overrides })) {
    process.env[k] = v
  }
}

export function restoreTestEnv(): void {
  if (!snapshot) return
  for (const k of Object.keys(process.env)) {
    if (!(k in snapshot)) delete process.env[k]
  }
  for (const [k, v] of Object.entries(snapshot)) {
    if (v !== undefined) process.env[k] = v
  }
  snapshot = undefined
}
