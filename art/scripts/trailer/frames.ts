// Frame worker: renders frames [from, to) of the trailer as PNGs into a folder. The build runs
// several of these in parallel; it can also be run alone for a partial render:
//   node --import tsx scripts/trailer/frames.ts --dir <out> --from 0 --to 24 [--voice <tmp>]

import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Renderer } from './render.ts';
import { writeRgbPng } from './pngfast.ts';
import { FPS } from './storyboard.ts';
import { readDecoded, envelopesOf } from './voice.ts';

export function frameName(i: number): string {
  return `f${String(i).padStart(5, '0')}.png`;
}

export function renderRange(dir: string, from: number, to: number, voiceTmp?: string, step = 1): void {
  mkdirSync(dir, { recursive: true });
  const env = voiceTmp ? envelopesOf(readDecoded(voiceTmp)) : undefined;
  const r = new Renderer(env && env.size ? env : undefined);
  for (let i = from; i < to; i += step) writeRgbPng(join(dir, frameName(i)), r.frame(i / FPS));
}

const isMain = process.argv[1] && /frames\.ts$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const arg = (k: string) => {
    const i = process.argv.indexOf('--' + k);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const dir = arg('dir')!;
  const from = parseInt(arg('from') ?? '0'), to = parseInt(arg('to') ?? '0');
  const step = parseInt(arg('step') ?? '1');
  const t0 = Date.now();
  renderRange(dir, from, to, arg('voice'), step);
  process.stdout.write(`frames ${from}..${to - 1} in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
}
