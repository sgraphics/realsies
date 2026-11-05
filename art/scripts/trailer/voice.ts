// Recorded voice drop-in: art/scripts/trailer/voice/<line-id>.wav (any format ffmpeg reads) is
// decoded to 48 kHz mono float, mixed under that line's subtitle instead of the blips, and its
// loudness drives the speaker's mouth.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { LINES } from './storyboard.ts';
import { SR, envelope, type VoiceClip } from './audio.ts';
import type { VoiceEnvelopes } from './interview.ts';

export function voiceDir(trailerDir: string): string {
  return join(trailerDir, 'voice');
}

/** Decode every voice file that matches a line id into `tmp` (as .f32) and return the clips. */
export function loadVoices(trailerDir: string, tmp: string): VoiceClip[] {
  const dir = voiceDir(trailerDir);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /\.(wav|mp3|m4a|flac|ogg|aiff?)$/i.test(f));
  const clips: VoiceClip[] = [];
  for (const l of LINES) {
    const f = files.find((x) => x.replace(/\.[^.]+$/, '') === l.id);
    if (!f) continue;
    const out = join(tmp, `voice-${l.id}.f32`);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(dir, f), '-ac', '1', '-ar', String(SR), '-f', 'f32le', out]);
    const buf = readFileSync(out);
    clips.push({ id: l.id, samples: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) });
  }
  return clips;
}

/** Re-read decoded clips in a frame worker (no ffmpeg needed there). */
export function readDecoded(tmp: string): VoiceClip[] {
  const clips: VoiceClip[] = [];
  for (const l of LINES) {
    const p = join(tmp, `voice-${l.id}.f32`);
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    clips.push({ id: l.id, samples: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) });
  }
  return clips;
}

export function envelopesOf(clips: VoiceClip[]): VoiceEnvelopes {
  const m: VoiceEnvelopes = new Map();
  for (const c of clips) m.set(c.id, envelope(c.samples));
  return m;
}
