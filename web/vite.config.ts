import { defineConfig } from 'vite';

// Dev server on 5173 proxies the relay (HTTP + WebSocket) on 3960.
// The app imports ../art/src and ../shared by relative path, hence fs.allow.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: 'http://localhost:3960', changeOrigin: true },
      '/ws': { target: 'http://localhost:3960', ws: true, changeOrigin: true },
    },
  },
  preview: { port: 5173 },
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 900 },
});
