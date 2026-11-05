// npm run new -- <name> [--from <variant>]
//   Scaffolds variants/<name>/ as a copy of variants/<from>/ (default for-realsies), with an empty
//   voice/ folder. A variant is named after its folder, so the copy renders as is.

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : undefined;
};
const from = opt('from') ?? 'for-realsies';
const name = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--from');

if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error('usage: npm run new -- <name> [--from <variant>]   (name: lowercase letters, digits and dashes)');
  process.exit(1);
}
const src = join(PKG, 'variants', from), dst = join(PKG, 'variants', name);
if (!existsSync(join(src, 'trailer.ts'))) {
  console.error(`no variant "${from}" to copy from`);
  process.exit(1);
}
if (existsSync(dst)) {
  console.error(`variants/${name} already exists`);
  process.exit(1);
}

// copy everything but the recordings: a new variant starts on blip voices
cpSync(src, dst, { recursive: true, filter: (p) => !p.startsWith(join(src, 'voice') + (process.platform === 'win32' ? '\\' : '/')) });
mkdirSync(join(dst, 'voice'), { recursive: true });
writeFileSync(join(dst, 'voice', '.gitkeep'), '');

console.log(`variants/${name}/ created from variants/${from}/:`);
for (const f of readdirSync(dst)) console.log('  ' + f);
console.log(`
next:
  1. edit variants/${name}/storyboard.ts (shots, timings, lines, cues) and cast.ts (who is in it)
  2. npm run render -- ${name}          (writes out/${name}/)
  3. drop recordings into variants/${name}/voice/<line-id>.wav if you want real voices`);
