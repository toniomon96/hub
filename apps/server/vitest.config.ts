import { defineConfig } from 'vitest/config'

/**
 * Mirror of the shim in @hub/db / @hub/capture / @hub/agent-runtime.
 * Needed by webhooks-e2e.test.ts which imports real @hub/db (node:sqlite).
 */
const NODE_BUILTINS_NEEDING_SHIM = new Set(['sqlite', 'test'])

const nodeBuiltinShim = {
  name: 'node-builtin-shim',
  enforce: 'pre' as const,
  resolveId(source: string) {
    const stripped = source.startsWith('node:') ? source.slice(5) : source
    if (NODE_BUILTINS_NEEDING_SHIM.has(stripped)) {
      return `\0node-builtin:${stripped}`
    }
    return null
  },
  load(id: string) {
    if (!id.startsWith('\0node-builtin:')) return null
    const name = id.slice('\0node-builtin:'.length)
    return [
      `import { createRequire } from 'node:module';`,
      `const require = createRequire(import.meta.url);`,
      `const m = require('node:${name}');`,
      `export default m;`,
      `export const DatabaseSync = m.DatabaseSync;`,
      `export const StatementSync = m.StatementSync;`,
    ].join('\n')
  },
}

export default defineConfig({
  plugins: [nodeBuiltinShim],
  test: {
    pool: 'forks',
  },
})
