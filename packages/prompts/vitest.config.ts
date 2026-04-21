import { defineConfig } from 'vitest/config'
import { nodeBuiltinShim } from '@hub/shared/testing/vitest-sqlite-shim'

export default defineConfig({
  plugins: [nodeBuiltinShim()],
  test: {
    pool: 'forks',
  },
})
