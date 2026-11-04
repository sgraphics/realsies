// npm run sheets: writes PNG contact sheets to art/out/ for visual QA.
// Usage: npm run sheets [-- filter]   (filter = substring of sheet names, e.g. "lobby" or "char")
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { colorsOf, type Rgba } from '../src/core/buffer.ts';
import { isMaster, hex } from '../src/core/palette.ts';
import { writePng } from './png.ts';
import { sheetsCharacters } from './sheets/characters.ts';
import { sheetsThemes } from './sheets/themes.ts';
import { sheetsUi } from './sheets/ui.ts';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'out');
const filter = process.argv[2] ?? '';
let count = 0;
const offPalette = new Map<string, Set<string>>();

export type SheetOut = (name: string, img: Rgba, opts?: { checkPalette?: boolean }) => void;
const out: SheetOut = (name, img, opts = {}) => {
  if (filter && !name.includes(filter)) return;
  if (opts.checkPalette !== false) {
    const bad = [...colorsOf(img)].filter((c) => !isMaster(c));
    if (bad.length) offPalette.set(name, new Set(bad.slice(0, 8).map(hex)));
  }
  writePng(join(OUT, name + '.png'), img);
  count++;
  console.log(`  ${name}.png  ${img.w}x${img.h}`);
};

const t0 = Date.now();
for (const [label, fn] of [['characters', sheetsCharacters], ['themes', sheetsThemes], ['ui', sheetsUi]] as const) {
  console.log(label + ':');
  await fn(out);
}
console.log(`${count} sheets in ${Date.now() - t0} ms -> ${OUT}`);
if (offPalette.size) {
  console.log('OFF-PALETTE COLOURS:');
  for (const [k, v] of offPalette) console.log('  ' + k + ': ' + [...v].join(' '));
  process.exitCode = 1;
}
