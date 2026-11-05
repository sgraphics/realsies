// Recorded voices: variants/<name>/voice/<line-id>.wav (any format ffmpeg reads) is decoded to
// 48 kHz mono float and mixed in from that line's start (when its text starts typing); its
// loudness drives the speaker's mouth on screen. What a line without a recording sounds like is
// the variant's choice: silent (mixVoices alone) or a synthesised stand-in (standInVoices).

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
 * The recordings: each clip plays from its line's start, panned a little toward its speaker, cut
 * at the end of the video. Lines without a recording add nothing.
 */
export function mixVoices(m: Mix, lines: Line[], voices: VoiceClip[], duration: number): void {
  for (const v of voices) {
    const l = lines.find((x) => x.id === v.id);
    if (!l) continue;
    const pan = l.speaker === 'host' ? -0.15 : l.speaker === 'guest' ? 0.15 : 0;
    const dur = v.samples.length / SR;
    m.add(l.at, Math.min(dur, duration - l.at), pan, (i) => v.samples[i] * 0.9);
  }
}

/**
 * Synthesised stand-ins for the lines without a recording, for a variant that wants them: blips
 * for dialogue, typewriter ticks for cards and taglines (at their gains).
 */
export function standInVoices(m: Mix, lines: Line[], voices: VoiceClip[], gains: { card: number; tagline: number }): void {
  const voiced = new Set(voices.map((v) => v.id));
  for (const l of lines) {
    if (voiced.has(l.id)) continue;
    if (l.speaker === 'host' || l.speaker === 'guest') blips(m, l);
    else ticks(m, l, l.speaker === 'card' ? gains.card : gains.tagline);
  }
}
