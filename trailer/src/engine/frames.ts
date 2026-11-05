// Frames: time in, a 1920x1080 RGBA frame out (the variant's drawer for the shot at t, then the
// shot's fade-out), and the whole trailer as numbered PNGs in a folder.

import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Rgba } from '../art.ts';
import { newFrame, fadeBuffer } from './camera.ts';
import { writeRgbPng } from './png.ts';
import { shotAt } from './timeline.ts';
import type { TrailerDef } from './types.ts';
import type { VoiceEnvelopes } from './audio/voice.ts';

export type FrameAt = (t: number) => Rgba;

/** A frame function for a variant. The returned buffer is reused between calls. */
export function frameRenderer(def: TrailerDef, voice?: VoiceEnvelopes): FrameAt {
  const draw = def.drawer(voice);
  const out = newFrame();
  return (t: number) => {
    const shot = shotAt(def.shots, t);
    draw(out, shot, t);
    if (shot.fadeOut && t > shot.end - shot.fadeOut) fadeBuffer(out, Math.ceil(((t - (shot.end - shot.fadeOut)) / shot.fadeOut) * 6));
    return out;
  };
}

export function frameCount(def: TrailerDef): number {
  return Math.round(def.duration * def.fps);
}

export function frameName(i: number): string {
  return `f${String(i).padStart(5, '0')}.png`;
}

/** Render every frame of a variant as PNGs into `dir`. */
export function renderFrames(def: TrailerDef, dir: string, voice?: VoiceEnvelopes, progress?: (done: number, total: number) => void): number {
  mkdirSync(dir, { recursive: true });
  const frame = frameRenderer(def, voice);
  const n = frameCount(def);
  for (let i = 0; i < n; i++) {
    writeRgbPng(join(dir, frameName(i)), frame(i / def.fps));
    if (progress && (i + 1) % 120 === 0) progress(i + 1, n);
  }
  return n;
}
