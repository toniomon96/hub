import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/schema.ts',
    'src/parser.ts',
    'src/registry.ts',
    'src/git.ts',
    'src/sync.ts',
    'src/outputs.ts',
    'src/dispatcher.ts',
    'src/schedule.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  platform: 'node',
  external: [/^@hub\//, /^node:/],
})
