import { defineConfig } from 'tsup'
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
})
