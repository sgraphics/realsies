// Dev preview of demo personas: a round's generated cast (or the personas folder) with cards, dials,
// typing speed and, for one of them, the full composed prompt. No network, no credits.
//
//   npx tsx tools/persona-preview.ts [seed] [count=9] [--prompt N] [--folder] [--at 2026-11-05T18:00:00Z]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCast } from '../src/persona/generate.js';
import { fromGenerated, loadPersonas, type Persona } from '../src/personas.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--folder'));
const seed = positional[0] ?? 'preview';
const count = Number(positional[1] ?? 9);
const at = opt('--at') ? Date.parse(opt('--at')!) : Date.now();
const show = opt('--prompt');

const cast: Persona[] = args.includes('--folder')
  ? loadPersonas(path.resolve(here, '../personas'), at)
  : generateCast(seed, count, at).map((g) => fromGenerated(g, g.level, at));
cast.forEach((p, i) => {
  const c = p.card!;
  console.log(`${String(i).padStart(2)} ${p.id.padEnd(26)} ${p.model.split('/')[1].slice(0, 12).padEnd(12)} L${p.levels.join(',')}  ${c.name}, ${c.age}, ${c.gender}, ${c.mbti} ${c.temperament}, ${c.home}, ${c.job}, ${c.mood}`);
  console.log(`   style: ${c.style}  [emoji ${c.emoji}]`);
  console.log(`   dials: ${Object.entries(p.traits).map(([k, v]) => `${k} ${v}`).join(', ')}; ${p.cps} cps; interests ${p.interests.join(', ')}; prompt ${p.prompt.length} chars`);
});
if (show !== undefined) {
  const p = cast[Number(show)] ?? cast.find((x) => x.id === show);
  if (p) console.log(`\n--- prompt of ${p.id} ---\n${p.prompt}`);
}
