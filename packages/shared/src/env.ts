import { z } from 'zod'

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
})

export type Env = z.infer<typeof EnvSchema>

let cached: Env | undefined

/**
 * Load and validate env. Caches after first call.
 * Pass an explicit object for tests; otherwise reads process.env.
 */
export function loadEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Env {
  if (cached) return cached
  const parsed = EnvSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  cached = parsed.data
  return cached
}

/** Test-only: reset the cached env. */
export function _resetEnvCache(): void {
  cached = undefined
}
