import { defineConfig } from 'vitest/config'

/**
 * Vite's transformer strips the `node:` prefix and then tries to load `sqlite`
 * as a normal module. Returning {external: true} from resolveId isn't honored
 * by Vite's loader for built-ins it doesn't recognize. So we resolve to a
 * virtual module id and return a tiny ESM shim that re-imports via Node's
 * own createRequire — bypassing Vite's loader entirely.
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
