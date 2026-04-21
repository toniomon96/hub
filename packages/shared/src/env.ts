import { z } from 'zod'
import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Hub environment schema. Validated once at process startup.
 * Fail-fast on missing required vars; never read process.env directly elsewhere.
 */
const EnvSchema = z.object({
  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY required'),

  // Models
  HUB_DEFAULT_MODEL: z.string().default('claude-sonnet-4-5'),
  HUB_LOCAL_MODEL_TRIVIAL: z.string().default('phi4-mini'),
  HUB_LOCAL_MODEL_PRIVATE: z.string().default('qwen3:7b'),
  HUB_LOCAL_MODEL_FALLBACK: z.string().default('llama3.3'),

  // Ollama
  OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),

  // Notion
  NOTION_TOKEN: z.string().optional(),
  NOTION_VERSION: z.string().default('2025-09-03'),

  // Obsidian
  OBSIDIAN_API_KEY: z.string().optional(),
  OBSIDIAN_HOST: z.string().default('127.0.0.1'),
  OBSIDIAN_PORT: z.coerce.number().int().positive().default(27123),
  OBSIDIAN_VAULT_PATH: z.string().optional(),

  // Google Workspace
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),

  // Todoist
  TODOIST_API_TOKEN: z.string().optional(),
  TODOIST_MCP_PATH: z.string().optional(),

  // GitHub
  GITHUB_PAT: z.string().optional(),

  // Server
  HUB_PORT: z.coerce.number().int().positive().default(4567),
  HUB_HOST: z.string().default('127.0.0.1'),
  HUB_TIMEZONE: z.string().default('America/Chicago'),

  // DB
  HUB_DB_PATH: z.string().default('./data/hub.db'),

  // Logging
  HUB_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HUB_LOG_DIR: z.string().default('./logs'),

  // Notifications
  NTFY_TOPIC: z.string().optional(),
  NTFY_URL: z.string().url().default('https://ntfy.sh'),

  // Privacy router (load-bearing: enforced from MVP day 1)
  HUB_SENSITIVITY_PATTERNS: z.string().default(''),

  // Cost ceiling — when today's Anthropic spend ≥ this USD cap, the router
  // silently downgrades cloud routes to the local fallback model.
  // Default 5 USD/day: enough for exploratory use, low enough to cap runaway loops.
  HUB_DAILY_USD_CAP: z.coerce.number().nonnegative().default(5),

  // Shared secret for all /webhooks/* endpoints. Required to be non-empty
  // when the server is running in production; empty string means webhooks
  // refuse all traffic. Dev/test can set any value. 32+ random bytes in prod.
  HUB_WEBHOOK_SECRET: z.string().default(''),

  // Browser UI shared token. Gates /api/* via header or signed cookie.
  // Empty => UI cannot authenticate; /api/* still accepts x-hub-secret for
  // the CLI/tools. Generate 32+ random bytes for prod.
  // Kept separate from HUB_WEBHOOK_SECRET so compromise of one does not
  // automatically compromise the other.
  HUB_UI_TOKEN: z.string().default(''),

  // Optional explicit cookie secret; if empty we HMAC with HUB_UI_TOKEN
  // itself (fine — cookies are only valid when the token still matches).
  HUB_COOKIE_SECRET: z.string().default(''),

  // Brief scheduler: when set to '1', the server starts the node-cron jobs for
  // the nightly 22:00 brief, 05:00 morning brief, Fri retro, Sun planning.
  // Defaults to '0' so dev/test never silently spend Anthropic credits.
  HUB_BRIEF_ENABLED: z.enum(['0', '1']).default('0'),
})

export type Env = z.infer<typeof EnvSchema>

let cached: Env | undefined
let dotenvLoaded = false

/**
 * Walk from cwd upward looking for a .env file (so the CLI works from any subdir).
 * Only runs once per process. Test env can skip by setting HUB_SKIP_DOTENV=1.
 */
function ensureDotenv(): void {
  if (dotenvLoaded) return
  dotenvLoaded = true
  if (process.env['HUB_SKIP_DOTENV'] === '1') return
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env')
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate })
      return
    }
    const parent = resolve(dir, '..')
    if (parent === dir) return
    dir = parent
  }
}

/**
 * Load and validate env. Caches after first call.
 * Pass an explicit object for tests; otherwise reads process.env (after .env load).
 */
export function loadEnv(source?: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  if (cached) return cached
  if (!source) ensureDotenv()
  const parsed = EnvSchema.safeParse(source ?? process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  const env = parsed.data
  const nodeEnv = (source ?? process.env)['NODE_ENV']
  const isProd = nodeEnv === 'production'

  // HUB_COOKIE_SECRET must be distinct from HUB_UI_TOKEN in prod.
  // Same-string reuse means a leak of the UI bearer token also compromises
  // the HMAC key used to mint cookies — two trust domains collapse into one.
  if (env.HUB_UI_TOKEN !== '') {
    if (env.HUB_COOKIE_SECRET === '') {
      if (isProd) {
        throw new Error(
          'HUB_COOKIE_SECRET must be set (and distinct from HUB_UI_TOKEN) when NODE_ENV=production',
        )
      }
      // Dev fallback: derive a cookie secret that is NOT equal to the token
      // (so auth.ts can drop the `|| HUB_UI_TOKEN` fallback unconditionally).
      // This is still a dev crutch, not a secret — set HUB_COOKIE_SECRET
      // explicitly before deploying anywhere reachable.
      env.HUB_COOKIE_SECRET = `${env.HUB_UI_TOKEN}:cookie:dev`
      process.stderr.write(
        '[hub/env] HUB_COOKIE_SECRET not set; using dev-only fallback derived from HUB_UI_TOKEN. Set HUB_COOKIE_SECRET explicitly in prod.\n',
      )
    } else if (env.HUB_COOKIE_SECRET === env.HUB_UI_TOKEN) {
      if (isProd) {
        throw new Error('HUB_COOKIE_SECRET must differ from HUB_UI_TOKEN when NODE_ENV=production')
      }
      process.stderr.write(
        '[hub/env] HUB_COOKIE_SECRET equals HUB_UI_TOKEN; set a distinct value before deploying.\n',
      )
    }
  }

  cached = env
  return cached
}

/** Test-only: reset the cached env. */
export function _resetEnvCache(): void {
  cached = undefined
}
