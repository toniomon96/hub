import { defineConfig } from 'tsup'
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node20',
  platform: 'node',
  // Don't bundle workspace deps - they ship their own dist with `node:` prefix
  // preserved (db package uses bundle:false specifically for node:sqlite).
  // Re-bundling them here would re-trigger esbuild's prefix-stripping bug.
  external: [/^@hub\//, /^node:/],
  banner: { js: '#!/usr/bin/env node' },
})
