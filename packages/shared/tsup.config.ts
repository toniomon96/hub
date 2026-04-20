import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/env.ts', 'src/log.ts', 'src/types.ts', 'src/ids.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
})
