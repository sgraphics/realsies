// ffmpeg steps: two-pass loudness normalisation (with a limiter loop that keeps loudnorm linear),
// the H.264 + AAC encode of a PNG frame folder, and the checks on the result.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { writeWav, limit, peakOf, type Stereo } from './audio/dsp.ts';

/**
 * Target loudness and true-peak ceiling. LRA is not a processing target: loudnorm only stays linear
 * (no compression, the quiet parts stay quiet) while the measured loudness range is under it, so it
 * is set above any range a trailer here spans (a quiet interview against a loud montage is ~22 LU).
 */
export const LOUDNESS = { I: -14, TP: -1.5, LRA: 30 };

export function ff(argv: string[], what: string): string {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...argv], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg (${what}) failed:\n${r.stderr.slice(-3000)}`);
  return r.stderr;
}

function lastJson(s: string): Record<string, string> {
  return JSON.parse(s.slice(s.lastIndexOf('{'), s.lastIndexOf('}') + 1));
}

/**
 * Measure the mix, pull its peaks down until the target gain fits under the true-peak ceiling
 * (so loudnorm can stay linear and the quiet parts stay quiet), then normalise to -14 LUFS.
 * Writes tmp/mix.wav and tmp/audio.wav; returns the normalised file.
 */
export function normaliseLoudness(mix: Stereo, tmp: string, log: (s: string) => void): string {
  const { I: TARGET_I, TP: TARGET_TP, LRA: TARGET_LRA } = LOUDNESS;
  const mixWav = join(tmp, 'mix.wav');
  let m: Record<string, string> = {};
  for (let it = 0; it < 6; it++) {
    writeWav(mixWav, mix);
    m = lastJson(ff(['-nostats', '-i', mixWav, '-af', `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:print_format=json`, '-f', 'null', '-'], 'measure'));
    const gain = TARGET_I - parseFloat(m.input_i);
    const tpAfter = parseFloat(m.input_tp) + gain;
    log(`  pass ${it + 1}: ${m.input_i} LUFS, true peak ${m.input_tp} dBTP, LRA ${m.input_lra} LU -> peak after gain ${tpAfter.toFixed(2)} dBTP`);
    if (tpAfter <= TARGET_TP - 0.25) break;
    // the limiter works on sample peaks, so lower its ceiling by the measured true-peak excess
    // (inter-sample overshoot included)
    const excess = tpAfter - (TARGET_TP - 0.4);
    limit(mix, peakOf(mix) * Math.pow(10, -excess / 20));
  }
  const audioWav = join(tmp, 'audio.wav');
  const norm = lastJson(ff([
    '-nostats', '-y', '-i', mixWav, '-af',
    `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`,
    '-ar', '48000', '-c:a', 'pcm_f32le', audioWav,
  ], 'normalise'));
  log(`  loudnorm: ${norm.normalization_type}, output ${norm.output_i} LUFS, ${norm.output_tp} dBTP`);
  return audioWav;
}

/** H.264 (CRF 18, yuv420p, BT.709 tagged) + AAC 192k, faststart, from f%05d.png frames. */
export function encodeMp4(framesDir: string, fps: number, audioWav: string, mp4: string): void {
  ff([
    '-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(framesDir, 'f%05d.png'), '-i', audioWav,
    '-map', '0:v:0', '-map', '1:a:0',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'animation',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', '-shortest', mp4,
  ], 'encode');
}

/** Streams, duration, size and loudness of an encoded file, for the log. */
export function check(mp4: string, log: (s: string) => void): { duration: number; sizeMb: number; lufs?: string } {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,color_space,sample_rate,channels', '-of', 'json', mp4], { encoding: 'utf8' });
  const p = JSON.parse(probe.stdout);
  for (const s of p.streams) log('  ' + (s.codec_type === 'video' ? `video ${s.codec_name} ${s.width}x${s.height} ${s.r_frame_rate} ${s.pix_fmt} ${s.color_space ?? ''}` : `audio ${s.codec_name} ${s.sample_rate} Hz x${s.channels}`));
  const duration = parseFloat(p.format.duration), sizeMb = parseInt(p.format.size) / 1e6;
  log(`  duration ${duration.toFixed(2)} s, ${sizeMb.toFixed(2)} MB`);
  const eb = ff(['-nostats', '-i', mp4, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], 'ebur128');
  const I = /I:\s+(-?[\d.]+) LUFS/.exec(eb.slice(eb.lastIndexOf('Summary')))?.[1];
  const TP = /Peak:\s+(-?[\d.]+) dBFS/.exec(eb.slice(eb.lastIndexOf('Summary')))?.[1];
  log(`  loudness ${I} LUFS integrated, true peak ${TP} dBFS`);
  return { duration, sizeMb, lufs: I };
}
