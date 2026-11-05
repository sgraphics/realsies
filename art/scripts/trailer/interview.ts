// The interview: the set world with two directed seated actors, shot through the storyboard's
// framings, with the glitch on her face and palette fades. Subtitles are drawn by render.ts.

import { type Rgba, createBuffer, blit, get, px } from '../../src/core/buffer.ts';
import { PAL, TRANSPARENT, luminance, type Color } from '../../src/core/palette.ts';
import { hash01 } from '../../src/core/rng.ts';
import { Actor, CAST, REST, keyLight, type ActorState } from './actor.ts';
import { setLayers, tightBackLayer, drawSetLife, HOST_AT, GUEST_AT, WORLD_W, WORLD_H } from './set.ts';
import { shoot, letterbox, fadeBuffer, BAR, OUT_H } from './camera.ts';
import { BLINK, DIRECTION, GLITCH, GLITCH_FRAME, LINES, FPS, lineTimes, type Shot, type Speaker } from './storyboard.ts';

/** Per-line voice envelopes (when a recorded voice replaces the blips). */
export type VoiceEnvelopes = Map<string, { rate: number; env: Float32Array }>;

const VOWELS = new Set('aeiouyAEIOUY');

/** Is the speaker's mouth open at time t (typed blips, or the recorded voice's loudness)? */
export function mouthOpenAt(sp: Speaker, t: number, voice?: VoiceEnvelopes): boolean {
  for (const l of LINES) {
    if (l.speaker !== sp) continue;
    const v = voice?.get(l.id);
    if (v) {
      const i = Math.floor((t - l.at) * v.rate);
      if (i >= 0 && i < v.env.length) return v.env[i] > 0.18;
      continue;
    }
    const { chars, times, end } = lineTimes(l);
    if (t < l.at || t > end + 0.05) continue;
    let i = -1;
    for (let k = 0; k < times.length; k++) if (times[k] <= t) i = k;
    if (i < 0) return false;
    const ch = chars[i];
    // vowels open the mouth for the length of their blip; 'm' and 'h' hum with it shut
    return VOWELS.has(ch) && t - times[i] < Math.min(0.1, 1 / l.cps);
  }
  return false;
}

export function actorState(sp: Speaker, t: number, voice?: VoiceEnvelopes): ActorState {
  const d = DIRECTION[sp];
  const st: ActorState = { ...REST, ...d.base };
  for (const k of d.keys) if (t >= k.t) Object.assign(st, k.set);
  st.blink = d.blinks.some((b) => t >= b && t < b + BLINK);
  const off = d.breathOff.some(([a, b]) => t >= a && t < b);
  if (!off) {
    const ph = (((t + (sp === 'host' ? 0.4 : 1.7)) % d.breathPeriod) + d.breathPeriod) % d.breathPeriod / d.breathPeriod;
    st.breath = ph > 0.5 && ph < 0.78 ? 1 : 0;
  }
  st.mouthOpen = mouthOpenAt(sp, t, voice);
  return st;
}

export class Interview {
  private host = new Actor(CAST.host);
  private guest = new Actor(CAST.guest);
  private world = createBuffer(WORLD_W, WORLD_H);
  private fh = createBuffer(32, 48);
  private fg = createBuffer(32, 48);

  /** The set world at time t through a lens (exposed for QA). */
  worldAt(t: number, lens: 'wide' | 'tight', voice?: VoiceEnvelopes): Rgba {
    const L = setLayers();
    const w = this.world;
    w.data.set((lens === 'tight' ? tightBackLayer() : L.back).data);
    blit(w, L.mid, 0, 0);
    const a = this.host.seated(this.fh, actorState('host', t, voice));
    const b = this.guest.seated(this.fg, actorState('guest', t, voice));
    keyLight(b, { hair: 26 });
    blit(w, a, HOST_AT.x, HOST_AT.y);
    blit(w, b, GUEST_AT.x, GUEST_AT.y);
    if (lens === 'wide') blit(w, L.front, 0, 0);
    drawSetLife(w, t, lens === 'wide');
    const fr = Math.round(t * FPS);
    if (Math.abs(t * FPS - fr) < 1e-3 && fr >= GLITCH_FRAME && fr < GLITCH_FRAME + GLITCH.length) glitch(w, fr - GLITCH_FRAME);
    return w;
  }

  render(out: Rgba, shot: Shot, t: number, voice?: VoiceEnvelopes): void {
    const f = shot.framing!;
    const w = this.worldAt(t, f.lens, voice);
    if (shot.fadeIn && t < shot.start + shot.fadeIn) fadeBuffer(w, Math.ceil((1 - (t - shot.start) / shot.fadeIn) * 6));
    shoot(out, w, f, BAR, OUT_H - BAR);
    letterbox(out);
  }
}

// ---------------------------------------------------------------- the glitch

/**
 * Two frames of a tear across her face. Frame 0: bands of rows slide sideways, thin scanlines rip
 * across the whole picture, and her face flashes to a cyan and magenta negative. Frame 1: smaller
 * slides the other way, her pupils light up cyan, and a few dead pixels.
 */
function glitch(w: Rgba, variant: number): void {
  const gx = GUEST_AT.x, gy = GUEST_AT.y;
  // rows of the seated face: eyes at 19..22 (pupils 21..22), mouth at 24..26, chin at 28
  const fx0 = gx - 2, fx1 = gx + 34;
  const robotEyes = () => {
    // the pupils (looking at the lens by now) light up
    for (let y = gy + 20; y <= gy + 22; y++)
      for (let x = gx + 11; x <= gx + 20; x++) if (get(w, x, y) === PAL.black) px(w, x, y, y === gy + 20 ? PAL.white : PAL.cyan);
  };
  const negativeRows = (y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++)
      for (let x = fx0; x <= fx1; x++) {
        const c = get(w, x, y);
        if (c !== TRANSPARENT) px(w, x, y, negative(c));
      }
  };
  const shiftRows = (y0: number, y1: number, dx: number, x0 = 0, x1 = w.w) => {
    const src = new Uint8ClampedArray(w.data);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x < x1; x++) {
        const sx = Math.min(w.w - 1, Math.max(0, x - dx));
        const si = (y * w.w + sx) * 4, di = (y * w.w + x) * 4;
        w.data[di] = src[si];
        w.data[di + 1] = src[si + 1];
        w.data[di + 2] = src[si + 2];
        w.data[di + 3] = 255;
      }
  };
  if (variant === 0) {
    // the tear: the eye band and the mouth band flash negative and slide apart
    negativeRows(gy + 19, gy + 20);
    negativeRows(gy + 25, gy + 26);
    const bands: [number, number, number][] = [[11, 16, 2], [17, 18, -1], [19, 20, 4], [21, 23, -2], [24, 26, 3], [27, 29, -1]];
    for (const [a, b, dx] of bands) shiftRows(gy + a, gy + b, dx, fx0 - 8, fx1 + 8);
    // thin scanlines rip across the whole picture
    for (const [y, dx] of [[gy + 13, 12], [gy + 22, -10], [gy + 28, 7]] as const) shiftRows(y, y, dx);
  } else {
    // a frame later: the slide snaps the other way and her eyes glow like a screen
    robotEyes();
    const bands: [number, number, number][] = [[12, 18, -1], [19, 22, 2], [23, 24, -3], [25, 28, 1]];
    for (const [a, b, dx] of bands) shiftRows(gy + a, gy + b, dx, fx0 - 8, fx1 + 8);
    for (const [y, dx] of [[gy + 17, -6]] as const) shiftRows(y, y, dx);
    // a few dead pixels around the face
    for (let i = 0; i < 6; i++) {
      const x = gx + 4 + Math.floor(hash01(91, i) * 24), y = gy + 11 + Math.floor(hash01(92, i) * 8) + (i % 2) * 10;
      const c = [PAL.hotRed, PAL.lime, PAL.cyan][i % 3];
      px(w, x, y, c);
      px(w, x + 1, y, c);
    }
  }
}

function negative(c: Color): Color {
  const l = luminance(c);
  if (l < 45) return PAL.white;
  if (l < 95) return PAL.cyan;
  if (l < 150) return PAL.magenta;
  if (l < 200) return PAL.purple;
  return PAL.navyDark;
}
