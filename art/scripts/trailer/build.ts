// npm run trailer: renders the Realsies launch trailer end to end.
//   1. decode recorded voices (voice/<line-id>.*) if any
//   2. synthesise the soundtrack, peak-limit it, two-pass loudnorm to -14 LUFS (linear)
//   3. render every frame as a PNG into a temp folder
//   4. encode H.264 (CRF 18, yuv420p, BT.709) + AAC into the topic folder
//   5. write poster.png (end card), keyframes.png (one frame per shot), script.md
//   6. check the result with ffprobe and ebur128, delete the temp folder (unless --keep)
// Flags: --keep, --out <dir>, --no-video

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { synthesize, writeWav, limit, peakOf } from './audio.ts';
import { loadVoices } from './voice.ts';
import { renderRange } from './frames.ts';
import { renderEndCard } from './endcard.ts';
import { keyframeSheet } from './sheet.ts';
import { scriptMarkdown } from './scriptmd.ts';
import { writeRgbPng } from './pngfast.ts';
import { newFrame } from './camera.ts';
import { DURATION, FPS } from './storyboard.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const args = process.argv.slice(2);
const flag = (k: string) => args.includes('--' + k);
const opt = (k: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = resolve(opt('out') ?? join(ROOT, '.bl0x', 'topics', 'near-hackathon', 'trailer'));
const TARGET_I = -14, TARGET_TP = -1.5, TARGET_LRA = 20;

function ff(argv: string[], what: string): string {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...argv], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg (${what}) failed:\n${r.stderr.slice(-3000)}`);
  return r.stderr;
}
function lastJson(s: string): Record<string, string> {
  return JSON.parse(s.slice(s.lastIndexOf('{'), s.lastIndexOf('}') + 1));
}
const step = (s: string) => console.log(`\n== ${s}`);

const t0 = Date.now();
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'realsies-trailer-'));
console.log(`temp: ${tmp}\nout:  ${OUT}`);
try {
  step('voices');
  const voices = loadVoices(HERE, tmp);
  console.log(voices.length ? `recorded: ${voices.map((v) => v.id).join(', ')}` : 'none found, using blip voices');

  step('audio');
  const mix = synthesize(voices);
  const mixWav = join(tmp, 'mix.wav');
  let m: Record<string, string> = {};
  for (let it = 0; it < 6; it++) {
    writeWav(mixWav, mix);
    m = lastJson(ff(['-nostats', '-i', mixWav, '-af', `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:print_format=json`, '-f', 'null', '-'], 'measure'));
    const gain = TARGET_I - parseFloat(m.input_i);
    const tpAfter = parseFloat(m.input_tp) + gain;
    console.log(`  pass ${it + 1}: ${m.input_i} LUFS, true peak ${m.input_tp} dBTP, LRA ${m.input_lra} LU -> peak after gain ${tpAfter.toFixed(2)} dBTP`);
    if (tpAfter <= TARGET_TP - 0.25) break;
    // pull the peaks down so the whole mix can take the gain linearly; the limiter works on sample
    // peaks, so lower its ceiling by the measured true-peak excess (inter-sample overshoot included)
    const excess = tpAfter - (TARGET_TP - 0.4);
    limit(mix, peakOf(mix) * Math.pow(10, -excess / 20));
  }
  const audioWav = join(tmp, 'audio.wav');
  const norm = lastJson(ff([
    '-nostats', '-y', '-i', mixWav, '-af',
    `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`,
    '-ar', '48000', '-c:a', 'pcm_f32le', audioWav,
  ], 'normalise'));
  console.log(`  loudnorm: ${norm.normalization_type}, output ${norm.output_i} LUFS, ${norm.output_tp} dBTP`);

  const N = Math.round(DURATION * FPS);
  const mp4 = join(OUT, 'realsies-trailer.mp4');
  if (!flag('no-video')) {
    step(`frames (${N})`);
    const fdir = join(tmp, 'frames');
    const tf = Date.now();
    for (let a = 0; a < N; a += 120) {
      renderRange(fdir, a, Math.min(N, a + 120), voices.length ? tmp : undefined);
      process.stdout.write(`  ${Math.min(N, a + 120)}/${N}\r`);
    }
    console.log(`  ${N} frames in ${((Date.now() - tf) / 1000).toFixed(1)} s`);

    step('encode');
    ff([
      '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(fdir, 'f%05d.png'), '-i', audioWav,
      '-map', '0:v:0', '-map', '1:a:0',
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'animation',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart', '-shortest', mp4,
    ], 'encode');
  }

  step('poster, keyframes, script');
  const poster = newFrame();
  renderEndCard(poster, DURATION, true);
  writeRgbPng(join(OUT, 'poster.png'), poster);
  writeRgbPng(join(OUT, 'keyframes.png'), keyframeSheet());
  let sizeMb: number | undefined;
  if (!flag('no-video')) sizeMb = statSync(mp4).size / 1e6;
  writeFileSync(join(OUT, 'script.md'), scriptMarkdown({ voices: voices.map((v) => v.id), sizeMb }));

  if (!flag('no-video')) {
    step('check');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,color_space,sample_rate,channels', '-of', 'json', mp4], { encoding: 'utf8' });
    const p = JSON.parse(probe.stdout);
    for (const s of p.streams) console.log('  ' + (s.codec_type === 'video' ? `video ${s.codec_name} ${s.width}x${s.height} ${s.r_frame_rate} ${s.pix_fmt} ${s.color_space ?? ''}` : `audio ${s.codec_name} ${s.sample_rate} Hz x${s.channels}`));
    console.log(`  duration ${parseFloat(p.format.duration).toFixed(2)} s, ${(parseInt(p.format.size) / 1e6).toFixed(2)} MB`);
    const eb = ff(['-nostats', '-i', mp4, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], 'ebur128');
    const I = /I:\s+(-?[\d.]+) LUFS/.exec(eb.slice(eb.lastIndexOf('Summary')))?.[1];
    const TP = /Peak:\s+(-?[\d.]+) dBFS/.exec(eb.slice(eb.lastIndexOf('Summary')))?.[1];
    console.log(`  loudness ${I} LUFS integrated, true peak ${TP} dBFS`);
  }
  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} finally {
  if (flag('keep')) console.log(`kept ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
}
