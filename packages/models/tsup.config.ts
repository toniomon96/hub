import { defineConfig } from 'tsup'
export default defineConfig({
  entry: ['src/index.ts', 'src/router.ts', 'src/ollama.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
})
