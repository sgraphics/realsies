// Dev preview of demo personas: a round's generated cast (or the personas folder) with cards, languages,
// dials, typing speed and, for one of them, the full composed prompt. No network, no credits.
//
//   npx tsx tools/persona-preview.ts [seed] [count=9] [--prompt N] [--folder] [--at 2026-11-05T18:00:00Z]
//   npx tsx tools/persona-preview.ts [seed] --cast [--size 39]     a full round cast as the relay builds it
//   npx tsx tools/persona-preview.ts --mix 2000 [--size 39]        nationality mix over many rounds vs the weights
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCast } from '../src/persona/generate.js';
import { buildCast, planCast } from '../src/persona/cast.js';
import { COUNTRY_WEIGHTS, REGIONS, regionOf } from '../src/persona/data.js';
import { fromGenerated, loadPersonas, type Persona } from '../src/personas.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const valued = new Set(['--prompt', '--at', '--size', '--mix']);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && valued.has(args[i - 1])));
const seed = positional[0] ?? 'preview';
const count = Number(positional[1] ?? 9);
const at = opt('--at') ? Date.parse(opt('--at')!) : Date.now();
const size = Number(opt('--size') ?? 39);
const show = opt('--prompt');
const folder = () => loadPersonas(path.resolve(here, '../personas'), at);
const demo = () => folder().filter((p) => p.brain.kind === 'default' && p.person);

if (opt('--mix')) {
  const rounds = Number(opt('--mix'));
  const hand = demo().map((p) => ({ id: p.id, country: p.person!.home.country, levels: p.levels }));
  const byCountry = new Map<string, number>();
  let total = 0, handN = 0;
  const handTimes = new Map<string, number>();
  for (let r = 0; r < rounds; r++) {
    for (const s of planCast(`mix-${r}`, size, hand)) {
      total++;
      byCountry.set(s.country, (byCountry.get(s.country) ?? 0) + 1);
      if (s.hand) handN++, handTimes.set(s.hand, (handTimes.get(s.hand) ?? 0) + 1);
    }
  }
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const wsum = Object.values(COUNTRY_WEIGHTS).reduce((a, b) => a + b, 0);
  console.log(`${rounds} rounds of ${size} characters (${total}): ${pct(handN / total)} hand-written (${(handN / rounds).toFixed(1)} a round), the rest generated`);
  for (const reg of REGIONS) {
    const got = [...byCountry].filter(([c]) => regionOf(c) === reg).reduce((a, [, n]) => a + n, 0) / total;
    const want = Object.entries(COUNTRY_WEIGHTS).filter(([c]) => regionOf(c) === reg).reduce((a, [, w]) => a + w, 0) / wsum;
    console.log(`  ${reg.padEnd(42)} ${pct(got).padStart(6)}  target ${pct(want)}`);
  }
  console.log(`  top: ${[...byCountry].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c, n]) => `${c} ${pct(n / total)}`).join(', ')}`);
  console.log(`  hand-written personas per round: ${[...handTimes].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${(n / rounds).toFixed(2)}`).join(', ')}`);
  process.exit(0);
}

const cast: Persona[] = args.includes('--folder')
  ? folder()
  : args.includes('--cast')
    ? buildCast({ seed, size, at, hand: demo() })
    : generateCast(seed, count, at).map((g) => fromGenerated(g, g.level, at));
cast.forEach((p, i) => {
  const c = p.card!;
  const langs = Object.entries(p.languages ?? {}).map(([l, v]) => `${l} ${v}`).join(', ');
  console.log(`${String(i).padStart(2)} ${p.id.padEnd(26)} ${p.model.split('/')[1].slice(0, 12).padEnd(12)} L${p.levels.join(',')} ${p.source === 'generated' ? 'gen ' : 'hand'} ${c.name}, ${c.age}, ${c.gender}, ${c.mbti} ${c.temperament}, ${c.home}, ${c.job}, ${c.mood}`);
  console.log(`   languages: ${langs}`);
  console.log(`   style: ${c.style}  [emoji ${c.emoji}]`);
  console.log(`   dials: ${Object.entries(p.traits).map(([k, v]) => `${k} ${v}`).join(', ')}; ${p.cps} cps; interests ${p.interests.join(', ')}; prompt ${p.prompt.length} chars`);
});
if (show !== undefined) {
  const p = cast[Number(show)] ?? cast.find((x) => x.id === show);
  if (p) console.log(`\n--- prompt of ${p.id} ---\n${p.prompt}`);
}
