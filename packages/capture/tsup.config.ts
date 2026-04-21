import { defineConfig } from 'tsup'
export default defineConfig({
  entry: ['src/index.ts', 'src/classify.ts', 'src/ingest.ts', 'src/inbox.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  // Keep cross-module imports intact so consumers (apps/server tests) can
  // vi.mock('@hub/models/ollama') and intercept the classifier's dependency.
  // With bundle: true (the default), tsup hoists ollama/classify into shared
  // chunks and the mock can't reach them. See ROADMAP.md v0.4 #3.
  bundle: false,
})
