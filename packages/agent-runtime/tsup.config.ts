import { defineConfig } from 'tsup'
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/run.ts',
    'src/stream.ts',
    'src/mcp-config.ts',
    'src/persist.ts',
    'src/brief.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
})
