// Bundles the relay into dist/index.js: plain ESM JavaScript runnable on Node 22.13+ (node:sqlite unflagged).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/index.js',
  sourcemap: true,
  // CJS dependencies (ws) call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __relayRequire } from 'node:module'; const require = __relayRequire(import.meta.url);" },
  // optional native speedups of ws, never required
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'info',
});
