import { loadEnv, getLogger } from '@hub/shared'

const log = getLogger('mcp-config')

/**
 * MCP server configurations grouped by capability scope.
 * The agent-runtime composes these per-query — only the servers an agent
 * actually needs are spun up. SDK handles stdio + HTTP transports natively.
 *
 * Type is `unknown[]` here to avoid a hard dep on the SDK's exported type
 * shape until we actually wire the SDK call. Replace with the SDK's
 * `McpServerConfig[]` type in run.ts when wiring.
 */

export interface McpServerStdio {
  type: 'stdio'
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface McpServerHttp {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

export type McpServerCfg = McpServerStdio | McpServerHttp

export interface McpScopes {
  knowledge: McpServerCfg[]
  workspace: McpServerCfg[]
  tasks: McpServerCfg[]
  code: McpServerCfg[]
  system: McpServerCfg[]
}

export type McpScopeName = keyof McpScopes

/**
 * Build the MCP scope map from current env. Skips any server whose required
 * env vars are missing — lets MVP run with just the 3 servers that are wired.
 */
export function buildMcpScopes(): McpScopes {
  const env = loadEnv()
  const scopes: McpScopes = { knowledge: [], workspace: [], tasks: [], code: [], system: [] }

  if (env.NOTION_TOKEN) {
    scopes.knowledge.push({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: {
        OPENAPI_MCP_HEADERS: JSON.stringify({
          Authorization: `Bearer ${env.NOTION_TOKEN}`,
          'Notion-Version': env.NOTION_VERSION,
        }),
      },
    })
  }

  if (env.OBSIDIAN_API_KEY) {
    scopes.knowledge.push({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'obsidian-mcp-server'],
      env: {
        OBSIDIAN_API_KEY: env.OBSIDIAN_API_KEY,
        OBSIDIAN_HOST: env.OBSIDIAN_HOST,
        OBSIDIAN_PORT: String(env.OBSIDIAN_PORT),
      },
    })
  }

  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) {
    scopes.workspace.push({
      type: 'stdio',
      command: 'uvx',
      args: ['workspace-mcp', '--tool-tier', 'extended'],
      env: {
        GOOGLE_OAUTH_CLIENT_ID: env.GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET: env.GOOGLE_OAUTH_CLIENT_SECRET,
      },
    })
  }

  if (env.TODOIST_API_TOKEN && env.TODOIST_MCP_PATH) {
    scopes.tasks.push({
      type: 'stdio',
      command: 'node',
      args: [env.TODOIST_MCP_PATH],
      env: { TODOIST_API_TOKEN: env.TODOIST_API_TOKEN },
    })
  }

  if (env.GITHUB_PAT) {
    scopes.code.push({
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: `Bearer ${env.GITHUB_PAT}` },
    })
  }

  // Desktop Commander — local only, no env required. Default-deny destructive
  // tools at the consent layer (see ARCHITECTURE.md §8 — tool-level allowlist).
  scopes.system.push({
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@wonderwhy-er/desktop-commander'],
  })

  return enforceAllowlist(scopes, env.HUB_MCP_STRICT === '1')
}

/**
 * Allowlist of MCP servers we know how to vouch for. Each entry is a predicate
 * on `McpServerCfg`. A server passes if at least one predicate returns true.
 *
 * Why a predicate list and not just a Set of commands: some servers (Todoist)
 * invoke a user-controlled node script path, and we want to allow any
 * .js/.mjs/.cjs file the operator configured via TODOIST_MCP_PATH — not a
 * wildcard `node *`.
 */
const ALLOWLIST: Array<(cfg: McpServerCfg) => boolean> = [
  // Notion
  (c) =>
    c.type === 'stdio' && c.command === 'npx' && c.args.includes('@notionhq/notion-mcp-server'),
  // Obsidian
  (c) => c.type === 'stdio' && c.command === 'npx' && c.args.includes('obsidian-mcp-server'),
  // Google Workspace
  (c) => c.type === 'stdio' && c.command === 'uvx' && c.args.includes('workspace-mcp'),
  // Todoist — user-configured node script (must end in .js/.mjs/.cjs)
  (c) =>
    c.type === 'stdio' &&
    c.command === 'node' &&
    c.args.length === 1 &&
    /\.(m|c)?js$/.test(c.args[0] ?? ''),
  // Desktop Commander
  (c) =>
    c.type === 'stdio' && c.command === 'npx' && c.args.includes('@wonderwhy-er/desktop-commander'),
  // GitHub Copilot MCP (HTTP)
  (c) => c.type === 'http' && c.url === 'https://api.githubcopilot.com/mcp/',
]

/**
 * Apply the allowlist to each scope. In strict mode, drop disallowed servers.
 * In non-strict mode, log a warning and keep them. Returning the filtered
 * scopes either way keeps call sites identical.
 */
export function enforceAllowlist(scopes: McpScopes, strict: boolean): McpScopes {
  const out: McpScopes = { knowledge: [], workspace: [], tasks: [], code: [], system: [] }
  for (const name of Object.keys(scopes) as McpScopeName[]) {
    for (const cfg of scopes[name]) {
      const allowed = ALLOWLIST.some((p) => p(cfg))
      if (allowed) {
        out[name].push(cfg)
        continue
      }
      const desc = cfg.type === 'stdio' ? `${cfg.command} ${cfg.args.join(' ')}` : cfg.url
      if (strict) {
        log.warn({ scope: name, cfg: desc }, 'mcp server rejected by allowlist (strict)')
      } else {
        log.warn({ scope: name, cfg: desc }, 'mcp server not on allowlist (permissive)')
        out[name].push(cfg)
      }
    }
  }
  return out
}
