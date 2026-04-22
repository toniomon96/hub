import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Reads HUB_PORT from env (same as the server) to proxy /api + /health.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const serverPort = env.HUB_PORT ?? '4567'
  const target = `http://127.0.0.1:${serverPort}`
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        '/api': { target, changeOrigin: false },
        '/auth': { target, changeOrigin: false },
        '/health': { target, changeOrigin: false },
        '/webhooks': { target, changeOrigin: false },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  }
})
