import { defineConfig } from 'vitest/config'
import { nodeBuiltinShim } from '@hub/shared/testing/vitest-sqlite-shim'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '..', '..')

export default defineConfig({
  plugins: [nodeBuiltinShim()],
  resolve: {
    // Redirect workspace package imports to their TS sources for tests so
    // Vite transforms the full import graph (and `vi.mock('@hub/models/ollama')`
    // intercepts imports made inside `@hub/capture/src/classify.ts`). Without
    // this, Vite treats the published `packages/*/dist/*.js` as node_modules
    // and skips its module-transform pipeline. See ROADMAP.md v0.4 #3.
    alias: {
      '@hub/capture/ingest': resolve(repoRoot, 'packages/capture/src/ingest.ts'),
      '@hub/capture/classify': resolve(repoRoot, 'packages/capture/src/classify.ts'),
      '@hub/capture/inbox': resolve(repoRoot, 'packages/capture/src/inbox.ts'),
      '@hub/capture': resolve(repoRoot, 'packages/capture/src/index.ts'),
      '@hub/models/ollama': resolve(repoRoot, 'packages/models/src/ollama.ts'),
      '@hub/models/router': resolve(repoRoot, 'packages/models/src/router.ts'),
      '@hub/models': resolve(repoRoot, 'packages/models/src/index.ts'),
      '@hub/shared/contracts': resolve(repoRoot, 'packages/shared/src/contracts/index.ts'),
      '@hub/shared/testing/test-env': resolve(repoRoot, 'packages/shared/testing/test-env.ts'),
      '@hub/shared': resolve(repoRoot, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    pool: 'forks',
  },
})
