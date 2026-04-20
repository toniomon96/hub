import { defineConfig } from 'tsup'
export default defineConfig({
  entry: ['src/index.ts', 'src/classify.ts', 'src/ingest.ts', 'src/inbox.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
})
