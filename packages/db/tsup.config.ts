import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/schema.ts',
    'src/client.ts',
    'src/locks.ts',
    'src/migrate.ts',
    'src/spend.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  platform: 'node',
  // bundle:false → tsup transpiles each source file independently and
  // preserves imports verbatim. Critical for `node:sqlite` which older esbuild
  // normalizes into `sqlite` when bundling.
  bundle: false,
})
