// "Bot or human?" clips, one real chat each (variants/bot-or-human/).
//
//   npx tsx scripts/bot-or-human.ts <transcript.json> [--dashboard] [--only wide|tall] [--keep] [--no-video] [--stills 0.5,8,20]
//     Renders the clip in both shapes into out/bot-or-human/<name>/ (<name> is the transcript's file name):
//     <name>.mp4 (1920x1080, X) and <name>-vertical.mp4 (1080x1920, TikTok, Shorts, Reels, Telegram), H.264 + AAC;
//     poster.png and poster-vertical.png (the hook); keyframes.png and keyframes-vertical.png (contact sheets).
//     --dashboard  also copies the two videos into .bl0x/topics/near-hackathon/promo/
//     --only       one shape only;  --keep  keep the temp folder (frames, mix.wav, audio.wav)
//     --no-video   posters and contact sheets only (seconds);  --stills  also write the frames at these times (s)
//
//   npx tsx scripts/bot-or-human.ts --import <record.json> <transcript.json>
//     A transcript from a chat record of relay/tools/practice-transcript.ts (relay/data/practice-transcripts/):
//     every line, word for word, with its time. Then mark the lines the clip leaves out with "skip": true (keep 4 to
//     7; never reword) and render it.
//
// A new clip a day: play a chat (relay/tools/practice-transcript.ts), import it, mark the skips, render with
// --dashboard. The transcript checks itself (lines the pixel font cannot draw, length): see storyboard.ts.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Rgba, createBuffer, PAL } from '../src/art.ts';
import { fadeBuffer, fillOut, rectOut } from '../src/engine/camera.ts';
import { writeRgbPng } from '../src/engine/png.ts';
import { frameName } from '../src/engine/frames.ts';
import { drawString, measure } from '../src/engine/font.ts';
import { normaliseLoudness, encodeMp4, check } from '../src/engine/encode.ts';
import { tc } from '../src/engine/scriptmd.ts';
import { castLook } from '../src/engine/actor.ts';
import { BotOrHumanClip, SIZES, type ClipConfig, type Format } from '../src/scenes/promo/botorhuman.ts';
import { FPS, TEXT, planClip, clockAt, revealCard, type Plan } from '../variants/bot-or-human/storyboard.ts';
import { soundtrack } from '../variants/bot-or-human/sound.ts';
import { CAST, END_SEATS, lobbySeeds } from '../variants/for-realsies/cast.ts';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DASHBOARD = join(PKG, '..', '.bl0x', 'topics', 'near-hackathon', 'promo');
const args = process.argv.slice(2);
const flag = (k: string) => args.includes('--' + k);
const opt = (k: string) => (args.includes('--' + k) ? args[args.indexOf('--' + k) + 1] : undefined);
const log = (s: string) => console.log(s);

// ---------------------------------------------------------------- --import

if (flag('import')) {
  const [rec, dst] = args.filter((a) => !a.startsWith('--'));
  if (!rec || !dst) {
    console.error('usage: npx tsx scripts/bot-or-human.ts --import <record.json> <transcript.json>');
    process.exit(1);
  }
  const r = JSON.parse(readFileSync(rec, 'utf8'));
  if (!r.partner?.seed) throw new Error(`${rec}: no partner seed (a record from an older relay/tools/practice-transcript.ts; add "partner": {"name", "seed"} by hand)`);
  const lines = (r.events as { t: number; kind: string; text?: string }[]).filter((e) => e.kind === 'me' || e.kind === 'them').map((e) => ({ t: Math.round(e.t * 100) / 100, from: e.kind, text: e.text }));
  const tr = {
    about: 'A free practice chat (protocol v1.14) played on a local relay (mock chain, real NEAR AI enclave model) with relay/tools/practice-transcript.ts. Every line is verbatim with its time in seconds from the start of the chat; the bot lines are the model output, signed in the enclave. Lines marked skip are left out of the clip; nothing is reworded or reordered. The persona is the card the game revealed after the call.',
    source: { kind: 'practice', chatId: r.chatId, played: new Date().toISOString().slice(0, 10), level: r.level, call: r.result?.myCall === false ? 'bot' : r.result?.myCall === true ? 'human' : 'none', right: r.result?.right ?? null },
    theme: r.theme ?? 'space',
    partner: { name: r.partner.name, seed: r.partner.seed },
    coins: 0,
    lines,
    verdict: r.result?.truth ?? 'bot',
    model: r.result?.model,
    persona: r.result?.persona,
  };
  const text = JSON.stringify(tr, null, 2).replace(/"lines": \[[\s\S]*?\n {2}\]/, () => '"lines": [\n' + lines.map((l) => '    ' + JSON.stringify(l)).join(',\n') + '\n  ]');
  if (existsSync(dst)) throw new Error(`${dst} exists; not overwriting`);
  writeFileSync(dst, text + '\n');
  log(`wrote ${dst}: ${lines.length} lines. Mark the ones to leave out with "skip": true (keep 4 to 7), then render it.`);
  process.exit(0);
}

// ---------------------------------------------------------------- render

const file = args.find((a, i) => !a.startsWith('--') && !['--only', '--stills'].includes(args[i - 1] ?? ''));
if (!file) {
  console.error('usage: npx tsx scripts/bot-or-human.ts <transcript.json> [--dashboard] [--only wide|tall] [--keep] [--no-video] [--stills t,t,...]');
  process.exit(1);
}
let plan: Plan;
try {
  plan = planClip(resolve(file));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
const OUT = join(PKG, 'out', 'bot-or-human', plan.name);
mkdirSync(OUT, { recursive: true });
const only = opt('only') as Format | undefined;
const formats: Format[] = only ? [only] : ['wide', 'tall'];

function config(p: Plan): ClipConfig {
  const tr = p.transcript;
  const seeds = lobbySeeds();
  const isBot = tr.verdict === 'bot';
  return {
    theme: p.theme,
    level: p.level,
    partner: tr.partner,
    coins: tr.coins ?? 0,
    chat: p.chat,
    clock: (t) => clockAt(p, t),
    verdict: tr.verdict,
    model: tr.model,
    card: isBot ? revealCard(tr) : undefined,
    text: {
      hook: TEXT.hook,
      pause: TEXT.pause,
      title: isBot ? TEXT.titleBot : TEXT.titleHuman,
      note: tr.note,
      proof: isBot ? TEXT.proofBot : undefined,
      question: TEXT.question,
      url: TEXT.url,
      free: TEXT.free,
    },
    // the trailer's end-card three, as on every promo card
    trio: { left: seeds[END_SEATS.left], mid: castLook(CAST.guest), right: seeds[END_SEATS.right] },
    times: p.times,
  };
}

/** A frame at t, with the last 0.4 s fading through the palette to black. */
function frameAt(clip: BotOrHumanClip, out: Rgba, t: number): Rgba {
  clip.render(out, t);
  const fade = 0.4, from = plan.duration - fade;
  if (t > from) fadeBuffer(out, Math.ceil(((t - from) / fade) * 6));
  return out;
}

/** Box-downscale by an integer factor. */
function shrink(src: Rgba, f: number): Rgba {
  const w = Math.floor(src.w / f), h = Math.floor(src.h / f);
  const out = createBuffer(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let yy = 0; yy < f; yy++)
        for (let xx = 0; xx < f; xx++) {
          const i = ((y * f + yy) * src.w + x * f + xx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
        }
      const o = (y * w + x) * 4;
      out.data[o] = r / (f * f);
      out.data[o + 1] = g / (f * f);
      out.data[o + 2] = b / (f * f);
      out.data[o + 3] = 255;
    }
  return out;
}

/** One frame per shot, a quarter size, with its time and title. */
function contactSheet(clip: BotOrHumanClip, fmt: Format): Rgba {
  const f = 4, M = 16, LAB = 34, HEAD = 64;
  const tw = SIZES[fmt].w / f, th = SIZES[fmt].h / f;
  const cols = fmt === 'wide' ? 4 : 7;
  const rows = Math.ceil(plan.shots.length / cols);
  const W = M + cols * (tw + M), H = HEAD + rows * (th + LAB + M) + M;
  const sheet = createBuffer(W, H);
  fillOut(sheet, PAL.navyDark);
  drawString(sheet, `Bot or human? ${plan.name}  -  ${plan.duration.toFixed(1)} s, ${SIZES[fmt].w}x${SIZES[fmt].h}, ${FPS} fps`, M, 20, { color: PAL.white, scale: 3 });
  const frame = createBuffer(SIZES[fmt].w, SIZES[fmt].h);
  plan.shots.forEach((s, i) => {
    const x = M + (i % cols) * (tw + M), y = HEAD + Math.floor(i / cols) * (th + LAB + M);
    const t = shrink(frameAt(clip, frame, s.key), f);
    rectOut(sheet, x - 2, y - 2, tw + 4, th + 4, PAL.black);
    for (let yy = 0; yy < th; yy++) sheet.data.set(t.data.subarray(yy * tw * 4, (yy + 1) * tw * 4), ((y + yy) * W + x) * 4);
    const lab = `${tc(s.key)}`;
    drawString(sheet, lab, x, y + th + 8, { color: PAL.gold, scale: 2 });
    drawString(sheet, s.title, x + measure(lab) * 2 + 12, y + th + 8, { color: PAL.greyLight, scale: 2 });
  });
  return sheet;
}

const t0 = Date.now();
log(`clip: ${plan.name} (${basename(plan.file)}), ${plan.duration.toFixed(2)} s, ${plan.transcript.verdict}, theme ${plan.theme}`);
for (const n of plan.notes) log(`  note: ${n}`);
for (const m of plan.chat) log(`  ${tc(m.at)}  ${m.from === 'me' ? 'ME  ' : 'THEM'}  ${m.text}`);
const T = plan.times;
log(`  pause ${tc(T.chatTo)}, reveal ${tc(T.revealFrom)}, end card ${tc(T.endFrom)}, out ${tc(T.out)}`);

const tmp = mkdtempSync(join(tmpdir(), `bot-or-human-${plan.name}-`));
const made: string[] = [];
try {
  let audioWav = '';
  if (!flag('no-video')) {
    log('\n== audio');
    audioWav = normaliseLoudness(soundtrack(plan), tmp, log);
  }
  for (const fmt of formats) {
    const cfg = config(plan);
    const clip = new BotOrHumanClip(cfg, fmt);
    const suffix = fmt === 'wide' ? '' : '-vertical';
    log(`\n== ${fmt} ${SIZES[fmt].w}x${SIZES[fmt].h}`);
    clip.wrapped().forEach((rows, i) => log(`  bubble ${i + 1}: ${rows.map((r) => JSON.stringify(r)).join(' / ')}`));
    const frame = createBuffer(SIZES[fmt].w, SIZES[fmt].h);
    const poster = join(OUT, `poster${suffix}.png`);
    writeRgbPng(poster, frameAt(clip, frame, 0.3));
    const sheet = join(OUT, `keyframes${suffix}.png`);
    writeRgbPng(sheet, contactSheet(new BotOrHumanClip(cfg, fmt), fmt));
    made.push(poster, sheet);
    const stills = opt('stills');
    if (stills) {
      const dir = join(OUT, 'stills');
      mkdirSync(dir, { recursive: true });
      for (const s of stills.split(',').map(Number)) {
        const f = join(dir, `${fmt}-${s.toFixed(2)}.png`);
        writeRgbPng(f, frameAt(new BotOrHumanClip(cfg, fmt), frame, s));
        log(`  still ${f}`);
      }
    }
    if (flag('no-video')) continue;
    const frames = join(tmp, `frames-${fmt}`);
    mkdirSync(frames, { recursive: true });
    const n = Math.round(plan.duration * FPS);
    const tf = Date.now();
    for (let i = 0; i < n; i++) {
      writeRgbPng(join(frames, frameName(i)), frameAt(clip, frame, i / FPS));
      if ((i + 1) % 96 === 0) process.stdout.write(`  ${i + 1}/${n}\r`);
    }
    log(`  ${n} frames in ${((Date.now() - tf) / 1000).toFixed(1)} s`);
    const mp4 = join(OUT, `${plan.name}${suffix}.mp4`);
    encodeMp4(frames, FPS, audioWav, mp4);
    check(mp4, log);
    made.push(mp4);
    if (!flag('keep')) rmSync(frames, { recursive: true, force: true });
  }
  log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)} s:`);
  for (const f of made) log(`  ${f}`);
  if (flag('dashboard')) {
    mkdirSync(DASHBOARD, { recursive: true });
    for (const f of made.filter((x) => x.endsWith('.mp4'))) copyFileSync(f, join(DASHBOARD, basename(f)));
    log(`copied the videos to ${DASHBOARD}`);
  }
} finally {
  if (flag('keep')) log(`kept ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
}
