import { loadEnv } from '@hub/shared'

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

  return scopes
}
