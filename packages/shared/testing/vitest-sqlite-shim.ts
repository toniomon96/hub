/**
 * Vitest plugin that shims `node:sqlite` (and `node:test`) for Vite's loader.
 *
 * Vite's transformer strips the `node:` prefix and then tries to resolve
 * `sqlite` as a normal package — which fails. Returning `{external: true}`
 * from `resolveId` isn't honored by Vite's loader for built-ins it doesn't
 * recognize. So we redirect to a virtual module id and return a tiny ESM
 * shim that re-imports via Node's own `createRequire`, bypassing Vite's
 * loader entirely.
 *
 * Used by every workspace whose tests touch `@hub/db` (which imports
 * `node:sqlite`). Keep this file dependency-free — it is loaded by
 * `vitest.config.ts` before any package is built.
 */

import type { Plugin } from 'vite'

const NODE_BUILTINS_NEEDING_SHIM = new Set(['sqlite', 'test'])
const VIRTUAL_PREFIX = '\0node-builtin:'

export function nodeBuiltinShim(): Plugin {
  return {
    name: 'hub-node-builtin-shim',
    enforce: 'pre',
    resolveId(source: string) {
      const stripped = source.startsWith('node:') ? source.slice(5) : source
      if (NODE_BUILTINS_NEEDING_SHIM.has(stripped)) {
        return `${VIRTUAL_PREFIX}${stripped}`
      }
      return null
    },
    load(id: string) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null
      const name = id.slice(VIRTUAL_PREFIX.length)
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
}
