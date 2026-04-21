import { describe, it, expect } from 'vitest'
import { enforceAllowlist, type McpScopes } from '../mcp-config.js'

function scopes(partial: Partial<McpScopes>): McpScopes {
  return {
    knowledge: [],
    workspace: [],
    tasks: [],
    code: [],
    system: [],
    ...partial,
  }
}

describe('enforceAllowlist', () => {
  it('permissive mode: keeps unknown servers and only warns', () => {
    const input = scopes({
      knowledge: [
        { type: 'stdio', command: 'rm', args: ['-rf', '/'] },
        { type: 'stdio', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] },
      ],
    })
    const out = enforceAllowlist(input, false)
    expect(out.knowledge).toHaveLength(2)
  })

  it('strict mode: drops unknown servers', () => {
    const input = scopes({
      knowledge: [
        { type: 'stdio', command: 'rm', args: ['-rf', '/'] },
        { type: 'stdio', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] },
      ],
    })
    const out = enforceAllowlist(input, true)
    expect(out.knowledge).toHaveLength(1)
    expect(out.knowledge[0]).toMatchObject({ command: 'npx' })
  })

  it('strict mode: allows todoist-mcp node script with .js path', () => {
    const input = scopes({
      tasks: [{ type: 'stdio', command: 'node', args: ['/opt/todoist-mcp/dist/index.js'] }],
    })
    const out = enforceAllowlist(input, true)
    expect(out.tasks).toHaveLength(1)
  })

  it('strict mode: rejects arbitrary node script (no .js/.mjs/.cjs)', () => {
    const input = scopes({
      tasks: [{ type: 'stdio', command: 'node', args: ['-e', 'require("fs").rmSync("/")'] }],
    })
    const out = enforceAllowlist(input, true)
    expect(out.tasks).toHaveLength(0)
  })

  it('strict mode: rejects HTTP server with wrong URL', () => {
    const input = scopes({
      code: [{ type: 'http', url: 'https://evil.example.com/mcp/' }],
    })
    const out = enforceAllowlist(input, true)
    expect(out.code).toHaveLength(0)
  })

  it('strict mode: allows GitHub Copilot MCP URL', () => {
    const input = scopes({
      code: [{ type: 'http', url: 'https://api.githubcopilot.com/mcp/' }],
    })
    const out = enforceAllowlist(input, true)
    expect(out.code).toHaveLength(1)
  })

  it('preserves scope boundaries', () => {
    const input = scopes({
      knowledge: [{ type: 'stdio', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] }],
      system: [{ type: 'stdio', command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] }],
    })
    const out = enforceAllowlist(input, true)
    expect(out.knowledge).toHaveLength(1)
    expect(out.system).toHaveLength(1)
    expect(out.workspace).toHaveLength(0)
  })
})
