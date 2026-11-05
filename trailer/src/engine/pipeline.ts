// Render a variant end to end into an output folder:
//   1. decode recorded voices (variants/<name>/voice/<line-id>.*) if any
//   2. synthesise the soundtrack, peak-limit it, two-pass loudnorm to -14 LUFS (linear)
//   3. render every frame as a PNG into a temp folder
//   4. encode H.264 (CRF 18, yuv420p, BT.709) + AAC
//   5. write poster.png, keyframes.png (one frame per shot) and script.md
//   6. check the result with ffprobe and ebur128, delete the temp folder (unless keep)

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newFrame } from './camera.ts';
import { writeRgbPng } from './png.ts';
import { renderFrames, frameCount } from './frames.ts';
import { keyframeSheet } from './sheet.ts';
import { scriptMarkdown } from './scriptmd.ts';
import { normaliseLoudness, encodeMp4, check } from './encode.ts';
import { loadVoices, envelopesOf } from './audio/voice.ts';
import { resetNoise } from './audio/dsp.ts';
import type { TrailerDef } from './types.ts';

export interface RenderOptions {
  /** Output folder for the video, poster, keyframes and script. */
  out: string;
  /** Keep the temp folder (frames, mix.wav, audio.wav). */
  keep?: boolean;
  /** Skip frames and the encode (poster, keyframes and script only). */
  noVideo?: boolean;
  log?: (s: string) => void;
}

export interface Rendered {
  video: string;
  poster: string;
  keyframes: string;
  script: string;
  /** The temp folder, when kept. */
  tmp?: string;
}

export function renderTrailer(def: TrailerDef, o: RenderOptions): Rendered {
  const log = o.log ?? ((s: string) => console.log(s));
  const step = (s: string) => log(`\n== ${s}`);
  const t0 = Date.now();
  mkdirSync(o.out, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), `trailer-${def.name}-`));
  const videoName = def.video ?? 'realsies-trailer.mp4';
  const res: Rendered = {
    video: join(o.out, videoName),
    poster: join(o.out, 'poster.png'),
    keyframes: join(o.out, 'keyframes.png'),
    script: join(o.out, 'script.md'),
  };
  log(`variant: ${def.name}\ntemp: ${tmp}\nout:  ${o.out}`);
  try {
    step('voices');
    const voices = loadVoices(join(def.dir, 'voice'), def.lines, tmp);
    log(voices.length ? `recorded: ${voices.map((v) => v.id).join(', ')}` : 'none found, using blip voices');

    step('audio');
    resetNoise();
    const audioWav = normaliseLoudness(def.soundtrack(voices), tmp, log);

    if (!o.noVideo) {
      const n = frameCount(def);
      step(`frames (${n})`);
      const tf = Date.now();
      const env = voices.length ? envelopesOf(voices) : undefined;
      renderFrames(def, join(tmp, 'frames'), env, (d, total) => process.stdout.write(`  ${d}/${total}\r`));
      log(`  ${n} frames in ${((Date.now() - tf) / 1000).toFixed(1)} s`);
      step('encode');
      encodeMp4(join(tmp, 'frames'), def.fps, audioWav, res.video);
    }

    step('poster, keyframes, script');
    const poster = newFrame();
    def.poster(poster);
    writeRgbPng(res.poster, poster);
    writeRgbPng(res.keyframes, keyframeSheet(def));
    const sizeMb = o.noVideo ? undefined : statSync(res.video).size / 1e6;
    writeFileSync(res.script, scriptMarkdown(def, { voices: voices.map((v) => v.id), video: videoName, sizeMb }));

    if (!o.noVideo) {
      step('check');
      check(res.video, log);
    }
    log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    if (o.keep) {
      log(`kept ${tmp}`);
      res.tmp = tmp;
    } else rmSync(tmp, { recursive: true, force: true });
  }
  return res;
}
