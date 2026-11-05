// npm run render -- [variant] [--dashboard] [--keep] [--no-video]
//   Renders variants/<variant>/ (default for-realsies) into out/<variant>/: realsies-trailer.mp4,
//   poster.png, keyframes.png, script.md. --dashboard also copies those four files into the
//   dashboard topic folder (.bl0x/topics/near-hackathon/trailer/; its .card.json is never touched).

import { existsSync, copyFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderTrailer } from '../src/engine/pipeline.ts';
import type { TrailerDef } from '../src/engine/types.ts';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(PKG, '..');
const DASHBOARD = join(ROOT, '.bl0x', 'topics', 'near-hackathon', 'trailer');

const args = process.argv.slice(2);
const flag = (k: string) => args.includes('--' + k);
const name = args.find((a) => !a.startsWith('--')) ?? 'for-realsies';
const variants = readdirSync(join(PKG, 'variants')).filter((d) => existsSync(join(PKG, 'variants', d, 'trailer.ts')));
if (!variants.includes(name)) {
  console.error(`no variant "${name}". Variants: ${variants.join(', ')}`);
  process.exit(1);
}

const mod = await import(pathToFileURL(join(PKG, 'variants', name, 'trailer.ts')).href);
const def: TrailerDef = mod.trailer ?? mod.default;
const res = renderTrailer(def, { out: join(PKG, 'out', name), keep: flag('keep'), noVideo: flag('no-video') });

if (flag('dashboard')) {
  for (const f of [res.video, res.poster, res.keyframes, res.script]) if (existsSync(f)) copyFileSync(f, join(DASHBOARD, basename(f)));
  console.log(`copied to ${DASHBOARD}`);
}
