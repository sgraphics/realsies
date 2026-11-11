// npx tsx scripts/get-coins-clip.ts [--shots] [--wide] [--dashboard]
//   "Get coins in 20 seconds": how a player gets coins, made from the web app's own screens (mock mode). Wide
//   1920x1080 (out/get-coins/get-coins-20s.mp4) and vertical 1080x1920 (get-coins-20s-vertical.mp4); --wide
//   makes only the wide one. H.264 + AAC (a soft chiptune bed from src/engine/audio, taps and a chime).
//   --shots first takes the screenshots with web/scripts/qa-shot.sh; that needs the web build and the QA server:
//     (cd ../web && npm run build && node scripts/qa-serve.mjs)      # port 5173
//   Without --shots the ones in out/get-coins/shots/ are used. --dashboard copies the videos into
//   .bl0x/topics/near-hackathon/promo/.
//   The steps: the room (HUD: 50 coins) -> Coins -> the dialog, 1 NEAR and its quote -> waiting for the wallet ->
//   the room with 448 coins (50 + the quoted 398) -> Withdraw (200 coins, about 0.499 NEAR) -> the end card.
//   The highlight rects are the controls' boxes in CSS px at the two shot sizes (measured on the shots); if the
//   coins dialog's layout changes, measure them again (flood-fill a control's face colour in a shot).

import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuffer, type Rgba } from '../src/art.ts';
import { castLook } from '../src/engine/actor.ts';
import { writePng } from '../../art/scripts/png.ts';
import { ff, check, normaliseLoudness } from '../src/engine/encode.ts';
import { Mix, SR, resetNoise, fadeTail, midi, nn } from '../src/engine/audio/dsp.ts';
import { arpeggios, bassLine, beep, ping, chime, type Song } from '../src/engine/audio/instruments.ts';
import { ring, hand, tap, captionWide, captionTall, endCardWide, endCardTall, TALL_CAPTION, type Rect } from '../src/scenes/promo/getcoins.ts';
import { CAST, END_SEATS, lobbySeeds } from '../variants/for-realsies/cast.ts';
import { URL_TEXT } from '../variants/for-realsies/storyboard.ts';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(PKG, '..', 'web');
const OUT = join(PKG, 'out', 'get-coins');
const SHOTS = join(OUT, 'shots');
const DASHBOARD = join(PKG, '..', '.bl0x', 'topics', 'near-hackathon', 'promo');
const FPS = 30;
const XF = 0.4; // crossfade between screens, seconds
const UP = 4; // upscale before the push-in, so the crop moves in quarter pixels (no jitter)
const log = (s: string) => console.log(s);

// ---------------------------------------------------------------- the screens (web/src/qa.ts reads the query)

const BASE = 'mock=1&wallet=1&net=mainnet&swap=1&as=sam';
const STATES = {
  room: [`${BASE}&qa=swap&game=50&room=1`, 11000],
  empty: [`${BASE}&qa=swap&game=50`, 11000],
  quote: [`${BASE}&qa=swap&game=50&near=1`, 11000],
  wait: [`${BASE}&qa=swap-done&game=50&near=1&buy=1&wait=1`, 12000],
  after: [`${BASE}&qa=swap&game=448&room=1`, 11000],
  withdraw: [`${BASE}&qa=swap&game=448&withdraw=200`, 11000],
} as const;
type State = keyof typeof STATES;

type RectKey = 'coins' | 'preset1Empty' | 'preset1' | 'getCoins' | 'quoteLine' | 'flow' | 'withdrawRow' | 'withdrawBtn';

interface Layout {
  name: 'wide' | 'tall';
  css: [number, number];
  dpr: number;
  W: number;
  H: number;
  /** Height of the screen in the frame (tall: the caption band sits under it). */
  screenH: number;
  file: string;
  handK: number;
  tapSize: number;
  rects: Record<RectKey, Rect>;
}

const LAYOUTS: Layout[] = [
  {
    name: 'wide', css: [960, 540], dpr: 2, W: 1920, H: 1080, screenH: 1080, file: 'get-coins-20s.mp4', handK: 4, tapSize: 22,
    rects: {
      coins: { x: 248.5, y: 61, w: 225, h: 34 },
      preset1Empty: { x: 487, y: 181, w: 110, h: 39.5 },
      preset1: { x: 487, y: 169, w: 110, h: 39 },
      getCoins: { x: 351.5, y: 225, w: 369, h: 35 },
      quoteLine: { x: 237, y: 276.5, w: 470.5, h: 12 },
      flow: { x: 238.5, y: 364, w: 483, h: 38.5 },
      withdrawRow: { x: 238.5, y: 275, w: 482, h: 61.5 },
      withdrawBtn: { x: 351.5, y: 275, w: 369, h: 35 },
    },
  },
  {
    name: 'tall', css: [360, 540], dpr: 3, W: 1080, H: 1920, screenH: 1620, file: 'get-coins-20s-vertical.mp4', handK: 5, tapSize: 30,
    rects: {
      coins: { x: 98, y: 58, w: 76, h: 24 },
      preset1Empty: { x: 186, y: 180, w: 67.7, h: 38 },
      preset1: { x: 186, y: 159, w: 67.7, h: 38 },
      getCoins: { x: 139, y: 211, w: 194, h: 38 },
      quoteLine: { x: 25.7, y: 263.3, w: 290.7, h: 30 },
      flow: { x: 27, y: 369, w: 306, h: 38 },
      withdrawRow: { x: 26, y: 270, w: 307, h: 62 },
      withdrawBtn: { x: 139, y: 270, w: 194, h: 38 },
    },
  },
];

// ---------------------------------------------------------------- the story

interface Seg {
  /** A screen, or the end card. */
  shot: State | 'end';
  dur: number;
  step?: number;
  /** The highlight ring, `gap` UI px clear of the control (default 3; less where the next control is close). */
  ring?: { rect: RectKey; at: number; gap?: number };
  /** The hand: on a control (its fingertip at fx, fy of the rect), from `at`; it taps at `tap`. */
  hand?: { rect: RectKey; fx: number; fy: number; at: number; tap: number };
  zoom: { to: number; focus?: RectKey };
}

const CAPTIONS: Record<number, { wide: string; tall: string[] }> = {
  1: { wide: 'Tap Coins', tall: ['Tap Coins'] },
  2: { wide: 'Choose how much NEAR', tall: ['Choose how much NEAR'] },
  3: { wide: 'Approve once in your wallet', tall: ['Approve once', 'in your wallet'] },
  4: { wide: 'Coins are in. Play.', tall: ['Coins are in. Play.'] },
  5: { wide: 'Withdraw any time: coins back to NEAR', tall: ['Withdraw any time:', 'coins back to NEAR'] },
};

const SEGS: Seg[] = [
  { shot: 'room', dur: 3.3, step: 1, hand: { rect: 'coins', fx: 0.66, fy: 0.6, at: 0.5, tap: 0.9 }, ring: { rect: 'coins', at: 0.9 }, zoom: { to: 1.14, focus: 'coins' } },
  { shot: 'empty', dur: 2.0, step: 2, hand: { rect: 'preset1Empty', fx: 0.62, fy: 0.6, at: 0.35, tap: 0.75 }, ring: { rect: 'preset1Empty', at: 0.75 }, zoom: { to: 1.06, focus: 'preset1Empty' } },
  // the hand taps Get coins near its top edge, so it stays clear of the quote line under the button
  { shot: 'quote', dur: 3.0, step: 2, ring: { rect: 'quoteLine', at: 0.35, gap: 2 }, hand: { rect: 'getCoins', fx: 0.84, fy: 0.14, at: 1.9, tap: 2.25 }, zoom: { to: 1.1, focus: 'quoteLine' } },
  { shot: 'wait', dur: 3.3, step: 3, ring: { rect: 'flow', at: 0.5 }, zoom: { to: 1.12, focus: 'flow' } },
  { shot: 'after', dur: 3.2, step: 4, ring: { rect: 'coins', at: 0.45 }, zoom: { to: 1.14, focus: 'coins' } },
  { shot: 'withdraw', dur: 3.8, step: 5, ring: { rect: 'withdrawRow', at: 0.5, gap: 2 }, hand: { rect: 'withdrawBtn', fx: 0.7, fy: 0.55, at: 1.3, tap: 1.7 }, zoom: { to: 1.1, focus: 'withdrawRow' } },
  { shot: 'end', dur: 3.2, zoom: { to: 1.03 } },
];
const starts = SEGS.map((_, i) => SEGS.slice(0, i).reduce((a, s) => a + s.dur - XF, 0));
const TOTAL = starts[SEGS.length - 1] + SEGS[SEGS.length - 1].dur;

// ---------------------------------------------------------------- shots

function takeShots(layouts: Layout[]): void {
  const up = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:5173/'], { encoding: 'utf8' });
  if (up.stdout.trim() !== '200') throw new Error('No QA server on port 5173: (cd web && npm run build && node scripts/qa-serve.mjs)');
  mkdirSync(SHOTS, { recursive: true });
  for (const L of layouts)
    for (const [name, [q, ms]] of Object.entries(STATES)) {
      const out = join(SHOTS, `${name}-${L.name}.png`);
      const r = spawnSync('bash', ['scripts/qa-shot.sh', out, `${L.css[0]}x${L.css[1]}`, String(L.dpr), q, String(ms)], { cwd: WEB, encoding: 'utf8' });
      log((r.stdout || r.stderr).trim());
      if (!existsSync(out)) throw new Error(`no shot: ${out}`);
    }
}

// ---------------------------------------------------------------- one segment

const px = (L: Layout, r: Rect) => ({ cx: (r.x + r.w / 2) * L.dpr, cy: (r.y + r.h / 2) * L.dpr });

function segment(L: Layout, s: Seg, i: number, tmp: string, end: string): string {
  const out = join(tmp, `seg${i}.mkv`);
  const sw = L.W, sh = L.screenH;
  const n = Math.round(s.dur * FPS);
  const still = (f: string) => ['-loop', '1', '-framerate', String(FPS), '-t', s.dur.toFixed(3), '-i', f];
  const inputs: string[] = [...still(s.shot === 'end' ? end : join(SHOTS, `${s.shot}-${L.name}.png`))];
  const chain: string[] = ['[0:v]format=rgba[b0]'];
  let last = 'b0', k = 1;
  const over = (img: Rgba, name: string, enable: string) => {
    const f = join(tmp, `${L.name}-${i}-${name}.png`);
    writePng(f, img);
    inputs.push(...still(f));
    chain.push(`[${last}][${k}:v]overlay=0:0:enable='${enable}'[b${k}]`);
    last = `b${k}`;
    k++;
  };
  if (s.shot !== 'end') {
    if (s.ring) over(ring(sw, sh, L.rects[s.ring.rect], L.dpr, s.ring.gap), 'ring', `gte(t,${s.ring.at})`);
    if (s.hand) {
      const r = L.rects[s.hand.rect];
      const tip = { x: r.x + r.w * s.hand.fx, y: r.y + r.h * s.hand.fy };
      over(hand(sw, sh, tip, L.dpr, L.handK), 'hand', `gte(t,${s.hand.at})`);
      over(tap(sw, sh, tip, L.dpr, L.tapSize), 'tap', `between(t,${s.hand.tap},${s.hand.tap + 0.2})`);
    }
  }
  // the push-in: ease in and out to `to`, the window drifting towards the focus as far as the frame allows
  const f = s.zoom.focus && s.shot !== 'end' ? px(L, L.rects[s.zoom.focus]) : { cx: sw / 2, cy: sh / 2 };
  const fx = (f.cx / sw).toFixed(5), fy = (f.cy / sh).toFixed(5);
  const z = `1+${(s.zoom.to - 1).toFixed(4)}*(1-cos(PI*min(1,in/${n - 1})))/2`;
  chain.push(
    `[${last}]scale=iw*${UP}:ih*${UP}:flags=neighbor,zoompan=z='${z}':x='max(0,min(iw-iw/zoom,${fx}*iw-iw/zoom/2))':y='max(0,min(ih-ih/zoom,${fy}*ih-ih/zoom/2))':d=1:s=${sw}x${sh}:fps=${FPS},format=rgba[z]`,
  );
  if (s.step === undefined) chain.push(L.screenH === L.H ? '[z]null[v]' : `[z]pad=${L.W}:${L.H}:0:0:color=black[v]`);
  else {
    const cap = join(tmp, `${L.name}-${i}-caption.png`);
    const c = CAPTIONS[s.step];
    writePng(cap, L.name === 'wide' ? captionWide(L.W, L.H, s.step, c.wide) : captionTall(L.W, s.step, c.tall));
    inputs.push(...still(cap));
    // one caption at a time: it changes at the middle of a crossfade (and stays through one between screens of a step)
    const from = i > 0 && SEGS[i - 1].step !== s.step ? XF / 2 : 0;
    const to = i < SEGS.length - 1 && SEGS[i + 1].step !== s.step ? s.dur - XF / 2 : s.dur + 1;
    const en = `enable='between(t,${from.toFixed(3)},${(to - 0.001).toFixed(3)})'`;
    if (L.screenH === L.H) chain.push(`[z][${k}:v]overlay=0:0:${en}[v]`);
    else chain.push(`[z]pad=${L.W}:${L.H}:0:0:color=black[zp]`, `[zp][${k}:v]overlay=0:${L.screenH}:${en}[v]`);
  }
  ff(['-y', '-loglevel', 'error', ...inputs, '-filter_complex', chain.join(';'), '-map', '[v]', '-frames:v', String(n), '-r', String(FPS), '-c:v', 'ffv1', '-pix_fmt', 'bgr0', out], `segment ${i}`);
  return out;
}

// ---------------------------------------------------------------- sound

/** A soft bed: 12.5% pulse arpeggios and a stepped triangle bass on I-vi-IV-V, a blip on every tap, coins, a chime. */
function soundtrack(tmp: string): string {
  resetNoise();
  const m = new Mix(TOTAL + 2.5);
  const bed = new Mix(TOTAL + 2.5);
  const bpm = 100, step = 60 / bpm / 4;
  const bars = Math.ceil(TOTAL / (16 * step)) + 1;
  const prog: [string[], string][] = [[['C', 'E', 'G'], 'C2'], [['A', 'C', 'E'], 'A1'], [['F', 'A', 'C'], 'F1'], [['G', 'B', 'D'], 'G1']];
  const song: Song = { at: 0, step, lead: [], chords: Array.from({ length: bars }, (_, b) => prog[b % 4][0]), roots: Array.from({ length: bars }, (_, b) => prog[b % 4][1]) };
  arpeggios(bed, song);
  bassLine(bed, song);
  // the bed fades in over the first second and gives way to the chime
  const endAt = starts[SEGS.length - 1];
  for (let i = 0; i < bed.L.length; i++) {
    const t = i / SR;
    const g = 0.55 * Math.min(1, t / 1.0) * (t < endAt ? 1 : Math.max(0, 1 - (t - endAt) / 0.5));
    m.L[i] += bed.L[i] * g;
    m.R[i] += bed.R[i] * g;
  }
  SEGS.forEach((s, i) => {
    if (s.hand) {
      beep(m, starts[i] + s.hand.tap, 1568, 0.045, 0.1, 0.25, 0.1);
      beep(m, starts[i] + s.hand.tap + 0.05, 2093, 0.06, 0.08, 0.25, 0.1);
    }
  });
  // the coins land: a little run of pings as the room comes back
  const landed = starts[SEGS.findIndex((s) => s.shot === 'after')] + 0.45;
  ['G6', 'C7', 'E7', 'G7'].forEach((nm, j) => ping(m, landed + j * 0.06, midi(nn(nm)), 0.5, 0.07, (j - 1.5) * 0.2));
  // the trailer's chime, at half strength: a soft landing, not a hit the limiter has to catch
  const ch = new Mix(TOTAL + 2.5);
  chime(ch, endAt + 0.15);
  for (let i = 0; i < m.L.length; i++) {
    m.L[i] += ch.L[i] * 0.45;
    m.R[i] += ch.R[i] * 0.45;
  }
  fadeTail(m, TOTAL, 0.8);
  return normaliseLoudness(m, tmp, log);
}

// ---------------------------------------------------------------- the clip

function clip(L: Layout, audio: string): string {
  const tmp = join(OUT, 'tmp', L.name);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const seeds = lobbySeeds();
  const trio = { left: seeds[END_SEATS.left], mid: castLook(CAST.guest), right: seeds[END_SEATS.right] };
  const endPng = join(tmp, 'end.png');
  const eb = createBuffer(L.W, L.H);
  (L.name === 'wide' ? endCardWide : endCardTall)(eb, trio, 'Real or not?', URL_TEXT);
  writePng(endPng, eb);
  const segs: string[] = [];
  SEGS.forEach((s, i) => {
    const t0 = Date.now();
    // the end card fills the whole frame, so it is shot at the frame's size
    const LL = s.shot === 'end' ? { ...L, screenH: L.H } : L;
    segs.push(segment(LL, s, i, tmp, endPng));
    log(`  ${L.name} segment ${i + 1}/${SEGS.length} (${s.shot}, ${s.dur}s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  });
  // crossfades between the segments
  const fx: string[] = [];
  let prev = '0:v';
  for (let i = 1; i < segs.length; i++) {
    const outL = i === segs.length - 1 ? 'vx' : `x${i}`;
    fx.push(`[${prev}][${i}:v]xfade=transition=fade:duration=${XF}:offset=${starts[i].toFixed(3)}[${outL}]`);
    prev = outL;
  }
  fx.push(`[vx]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv[v]`);
  const mp4 = join(OUT, L.file);
  ff([
    '-y', '-loglevel', 'error', ...segs.flatMap((f) => ['-i', f]), '-i', audio,
    '-filter_complex', fx.join(';'), '-map', '[v]', '-map', `${segs.length}:a:0`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'animation', '-r', String(FPS),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', TOTAL.toFixed(3), '-movflags', '+faststart', mp4,
  ], `encode ${L.name}`);
  log(`wrote ${mp4}`);
  check(mp4, log);
  return mp4;
}

const layouts = process.argv.includes('--wide') ? LAYOUTS.slice(0, 1) : LAYOUTS;
if (process.argv.includes('--shots')) takeShots(layouts);
for (const L of layouts) for (const st of Object.keys(STATES)) if (!existsSync(join(SHOTS, `${st}-${L.name}.png`))) throw new Error(`missing shot ${st}-${L.name}.png: run with --shots`);
log(`timeline: ${SEGS.map((s, i) => `${s.shot}@${starts[i].toFixed(2)}`).join(' ')}; ${TOTAL.toFixed(2)} s`);
mkdirSync(join(OUT, 'tmp'), { recursive: true });
const audio = soundtrack(join(OUT, 'tmp'));
const made = layouts.map((L) => clip(L, audio));
if (process.argv.includes('--dashboard')) {
  mkdirSync(DASHBOARD, { recursive: true });
  for (const f of made) copyFileSync(f, join(DASHBOARD, f.split(/[\\/]/).pop()!));
  log(`copied to ${DASHBOARD} (${made.map((f) => `${(statSync(f).size / 1e6).toFixed(1)} MB`).join(', ')})`);
}
