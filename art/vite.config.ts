import { defineConfig } from 'vite';

// Art demo: ten idling characters per theme on the lobby composition (npm run demo, port 5174).
export default defineConfig({
  server: { port: 5174, strictPort: true, fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
