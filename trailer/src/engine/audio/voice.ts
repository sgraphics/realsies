// Recorded voice drop-in: variants/<name>/voice/<line-id>.wav (any format ffmpeg reads) is decoded
// to 48 kHz mono float, mixed under that line instead of its blips or ticks, and its loudness
// drives the speaker's mouth on screen.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { type Mix, SR, envelope } from './dsp.ts';
import { blips, ticks } from './instruments.ts';
import type { Line } from '../timeline.ts';

export interface VoiceClip {
  id: string;
  samples: Float32Array; // mono, SR
}

/** Per-line loudness envelopes of the recorded voices (they open and close the mouth). */
export type VoiceEnvelopes = Map<string, { rate: number; env: Float32Array }>;

/** Decode every voice file in `dir` that matches a line id into `tmp` (as .f32) and return the clips. */
export function loadVoices(dir: string, lines: Line[], tmp: string): VoiceClip[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /\.(wav|mp3|m4a|flac|ogg|aiff?)$/i.test(f));
  const clips: VoiceClip[] = [];
  for (const l of lines) {
    const f = files.find((x) => x.replace(/\.[^.]+$/, '') === l.id);
    if (!f) continue;
    const out = join(tmp, `voice-${l.id}.f32`);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(dir, f), '-ac', '1', '-ar', String(SR), '-f', 'f32le', out]);
    const buf = readFileSync(out);
    clips.push({ id: l.id, samples: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) });
  }
  return clips;
}

export function envelopesOf(clips: VoiceClip[]): VoiceEnvelopes {
  const m: VoiceEnvelopes = new Map();
  for (const c of clips) m.set(c.id, envelope(c.samples));
  return m;
}

/**
 * The voice of every line: blips for dialogue, typewriter ticks for cards and taglines (at their
 * gains), skipping lines that have a recording; then the recordings themselves.
 */
export function voiceLines(m: Mix, lines: Line[], voices: VoiceClip[], duration: number, gains: { card: number; tagline: number }): void {
  const voiced = new Set(voices.map((v) => v.id));
  for (const l of lines) {
    if (voiced.has(l.id)) continue;
    if (l.speaker === 'host' || l.speaker === 'guest') blips(m, l);
    else ticks(m, l, l.speaker === 'card' ? gains.card : gains.tagline);
  }
  for (const v of voices) {
    const l = lines.find((x) => x.id === v.id);
    if (!l) continue;
    const pan = l.speaker === 'host' ? -0.15 : l.speaker === 'guest' ? 0.15 : 0;
    const dur = v.samples.length / SR;
    m.add(l.at, Math.min(dur, duration - l.at), pan, (i) => v.samples[i] * 0.9);
  }
}
