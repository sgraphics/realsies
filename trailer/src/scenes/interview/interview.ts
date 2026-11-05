// The interview scene: the painted set world with two directed seated actors (host left, guest
// right), shot through a framing or a push-in, with palette fades and the two-frame bot glitch
// in the guest's eyes. A shot draws the picture, then an optional overlay (the chat), then the
// cinema bars.

import { type Rgba, type Color, createBuffer, blit, get, px, PAL, TRANSPARENT, luminance, hash01 } from '../../art.ts';
import { Actor, REST, keyLight, type ActorState, type CastMember, type ActorDirection } from '../../engine/actor.ts';
import { shoot, fadeBuffer, letterbox, BAR, OUT_H } from '../../engine/camera.ts';
import { framingAt, lineTimes, type Line, type Shot, type Speaker } from '../../engine/timeline.ts';
import type { VoiceEnvelopes } from '../../engine/audio/voice.ts';
import { setLayers, tightBackLayer, drawSetLife, HOST_AT, GUEST_AT, WORLD_W, WORLD_H } from './set.ts';

export interface InterviewConfig {
  cast: { host: CastMember; guest: CastMember };
  /** Give the guest large blue eyes with highlights. */
  guestBigEyes: boolean;
  direction: Record<Speaker, ActorDirection>;
  /** Blink length (seconds). */
  blink: number;
  /** Every line (only host and guest lines move mouths). */
  lines: Line[];
  fps: number;
  /** First frame of the glitch in her eyes, and how many frames it lasts. */
  glitch: { frame: number; frames: number };
}

const VOWELS = new Set('aeiouyAEIOUY');

/** Something drawn over the picture before the bars (the chat). */
export interface Overlay {
  draw(out: Rgba, t: number): void;
}

export class InterviewScene {
  private host: Actor;
  private guest: Actor;
  private world = createBuffer(WORLD_W, WORLD_H);
  private fh = createBuffer(32, 48);
  private fg = createBuffer(32, 48);

  constructor(private cfg: InterviewConfig) {
    this.host = new Actor(cfg.cast.host);
    this.guest = new Actor(cfg.cast.guest);
    this.guest.bigEyes = cfg.guestBigEyes;
  }

  /** Is the speaker's mouth open at time t (typed blips, or the recorded voice's loudness)? */
  mouthOpenAt(sp: Speaker, t: number, voice?: VoiceEnvelopes): boolean {
    for (const l of this.cfg.lines) {
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

  actorState(sp: Speaker, t: number, voice?: VoiceEnvelopes): ActorState {
    const d = this.cfg.direction[sp];
    const st: ActorState = { ...REST, ...d.base };
    for (const k of d.keys) if (t >= k.t) Object.assign(st, k.set);
    st.blink = d.blinks.some((b) => t >= b && t < b + this.cfg.blink);
    const off = d.breathOff.some(([a, b]) => t >= a && t < b);
    if (!off) {
      const ph = (((t + (sp === 'host' ? 0.4 : 1.7)) % d.breathPeriod) + d.breathPeriod) % d.breathPeriod / d.breathPeriod;
      st.breath = ph > 0.5 && ph < 0.78 ? 1 : 0;
    }
    st.mouthOpen = this.mouthOpenAt(sp, t, voice);
    return st;
  }

  /** The set world at time t through a lens (exposed for QA). */
  worldAt(t: number, lens: 'wide' | 'tight', voice?: VoiceEnvelopes): Rgba {
    const L = setLayers();
    const w = this.world;
    w.data.set((lens === 'tight' ? tightBackLayer() : L.back).data);
    blit(w, L.mid, 0, 0);
    const a = this.host.seated(this.fh, this.actorState('host', t, voice));
    const b = this.guest.seated(this.fg, this.actorState('guest', t, voice));
    keyLight(b, { hair: 26 });
    blit(w, a, HOST_AT.x, HOST_AT.y);
    blit(w, b, GUEST_AT.x, GUEST_AT.y);
    if (lens === 'wide') blit(w, L.front, 0, 0);
    drawSetLife(w, t, lens === 'wide');
    const g = this.cfg.glitch;
    const fr = Math.round(t * this.cfg.fps);
    if (Math.abs(t * this.cfg.fps - fr) < 1e-3 && fr >= g.frame && fr < g.frame + g.frames) glitch(w, fr - g.frame);
    return w;
  }

  /** The picture only (world through the shot's framing or push-in, with its fade-in). */
  render(out: Rgba, shot: Shot, t: number, voice?: VoiceEnvelopes): void {
    const f = framingAt(shot, t);
    const w = this.worldAt(t, f.lens, voice);
    if (shot.fadeIn && t < shot.start + shot.fadeIn) fadeBuffer(w, Math.ceil((1 - (t - shot.start) / shot.fadeIn) * 6));
    shoot(out, w, f, BAR, OUT_H - BAR);
  }

  /** A whole interview shot: picture, overlay, cinema bars. */
  drawShot(out: Rgba, shot: Shot, t: number, voice?: VoiceEnvelopes, overlay?: Overlay): void {
    this.render(out, shot, t, voice);
    overlay?.draw(out, t);
    letterbox(out);
  }
}

// ---------------------------------------------------------------- the glitch

/**
 * Two frames of a tear through her eyes (the push-in ends on them). Frame 0: the rows of her eyes
 * slide apart, the irises flash to a cyan and magenta negative, thin scanlines rip across the
 * picture. Frame 1: the slide snaps back the other way and her irises glow like a screen, with a
 * few dead pixels.
 */
function glitch(w: Rgba, variant: number): void {
  const gx = GUEST_AT.x, gy = GUEST_AT.y;
  // her big eyes sit on seated rows 18..22 (head rows 14..18), columns 9..22 of her box
  const ex0 = gx + 9, ex1 = gx + 22, ey = gy + 18;
  const fx0 = gx - 2, fx1 = gx + 34;
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
  const eachEye = (fn: (x: number, y: number, c: Color) => void) => {
    for (let y = ey; y <= ey + 4; y++)
      for (let x = ex0; x <= ex1; x++) {
        const c = get(w, x, y);
        if (c !== TRANSPARENT) fn(x, y, c);
      }
  };
  if (variant === 0) {
    eachEye((x, y, c) => {
      if (y === ey + 1 || y === ey + 2) px(w, x, y, negative(c));
    });
    const bands: [number, number, number][] = [[-2, -1, 1], [0, 0, 1], [1, 2, -2], [3, 3, 2], [4, 4, -1], [5, 6, 1]];
    for (const [a, b, dx] of bands) shiftRows(ey + a, ey + b, dx, fx0 - 8, fx1 + 8);
    for (const [y, dx] of [[ey - 1, 4], [ey + 3, -5]] as const) shiftRows(y, y, dx);
  } else {
    // robot eyes: the irises glow cyan, the pupils and the highlights burn white
    for (const x0 of [gx + 10, gx + 17])
      for (let y = ey + 1; y <= ey + 3; y++)
        for (let x = x0 + 1; x <= x0 + 3; x++) {
          const c = get(w, x, y);
          px(w, x, y, c === PAL.blue || c === PAL.blueDark ? PAL.cyan : PAL.white);
        }
    const bands: [number, number, number][] = [[0, 0, -1], [1, 2, 1], [3, 4, -1]];
    for (const [a, b, dx] of bands) shiftRows(ey + a, ey + b, dx, fx0 - 8, fx1 + 8);
    shiftRows(ey + 2, ey + 2, -3);
    for (let i = 0; i < 6; i++) {
      const x = ex0 - 2 + Math.floor(hash01(91, i) * 18), y = ey - 2 + Math.floor(hash01(92, i) * 9);
      const c = [PAL.hotRed, PAL.lime, PAL.cyan][i % 3];
      px(w, x, y, c);
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
