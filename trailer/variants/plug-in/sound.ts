// Plug in: the soundtrack, all synthesised. A mains hum and faint rain hiss under everything; the
// plug's servo whine and steps, a heavy clunk with a zap as it seats, the LED beep, a power-up rush
// and a pulsing bass with a blip for each pulse of light; a sub drop and a shine as her eyes open,
// pings for the other two, and the game's chime on the last beat.
// The order of the calls below matters: they share one deterministic noise source.

import { Mix, resetNoise, fadeTail, midi, nn, white, ad, Biquad, Tri, SR, type Stereo } from '../../src/engine/audio/dsp.ts';
import { glitchSfx, kick, beep, whoosh, shing, ping, chime } from '../../src/engine/audio/instruments.ts';
import type { VoiceClip } from '../../src/engine/audio/voice.ts';
import { DURATION, FPS, CLUNK, GREEN, WAKE_AT, FINALE, f, pulses } from './storyboard.ts';

/** Mains hum (A1 and its harmonics) and a soft hiss for the rain. */
function bed(m: Mix): void {
  let a = 0, b = 0, c = 0;
  m.add(0, DURATION, 0, (_i, t) => {
    a += (2 * Math.PI * 55) / SR;
    b += (2 * Math.PI * 110) / SR;
    c += (2 * Math.PI * 165) / SR;
    const swell = 0.6 + 0.4 * Math.min(1, t / 0.4);
    return (Math.sin(a) * 0.05 + Math.sin(b) * 0.025 + Math.sin(c) * 0.012) * swell;
  });
  const hp = Biquad.make('hp', 5000);
  m.add(0, DURATION, 0.1, () => hp.next(white()) * 0.006);
}

/** The plug: a servo whine while it moves, a tick on each step, then the clunk. */
function plug(m: Mix): void {
  for (const [a, b] of [[4, 11], [17, 18], [20, 21]] as [number, number][]) {
    let ph = 0;
    const lp = Biquad.make('lp', 1800);
    const dur = f(b - a);
    m.add(f(a), dur, 0.3, (_i, t) => {
      ph += (260 + 240 * (t / dur)) / SR;
      const saw = 2 * (ph - Math.floor(ph + 0.5));
      return lp.next(saw) * 0.035 * Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.02);
    });
  }
  for (const n of [4, 5, 6, 7, 8, 9, 10, 11, 17, 20]) {
    const bp = Biquad.make('bp', 3400, 3);
    m.add(f(n), 0.02, 0.3, (_i, t) => bp.next(white()) * ad(t, 0.0005, 0.02, 6) * 0.25);
  }
  // the clunk: a kick, a low thump, two metal pings and the zap
  const at = f(CLUNK);
  kick(m, at, 1.3);
  let ph = 0;
  m.add(at, 0.25, 0, (_i, t) => Math.sin((ph += (2 * Math.PI * (70 - 120 * t)) / SR)) * ad(t, 0.002, 0.25, 4) * 0.3);
  ping(m, at, 1870, 0.35, 0.07, 0.3);
  ping(m, at, 2790, 0.25, 0.04, 0.3);
  glitchSfx(m, at + 0.01);
}

/** Power on: the LED beep and its flickers, a rising rush, a pulsing bass and a blip per pulse of light. */
function power(m: Mix): void {
  const g = f(GREEN);
  beep(m, g, midi(nn('G6')), 0.06, 0.09, 0.5, 0.3);
  beep(m, f(GREEN + 2), midi(nn('G6')), 0.04, 0.06, 0.5, 0.3);
  beep(m, f(GREEN + 4), midi(nn('D7')), 0.08, 0.08, 0.5, 0.3);
  whoosh(m, g, 0.7, 180, 9, 0.12);
  // bass: a triangle pluck on every half beat at 120 BPM, climbing as each of them wakes
  const note = (t: number) => (t < f(WAKE_AT.left) ? 'A1' : t < f(WAKE_AT.right) ? 'C2' : t < f(FINALE[0]) ? 'E2' : 'A1');
  let k = 0;
  for (let t = g + 0.25; t < DURATION; t += 0.25, k++) {
    const fr = midi(nn(note(t)));
    const o = new Tri();
    const acc = k % 2 === 0 ? 1 : 0.6;
    m.add(t, 0.22, 0, (_i, u) => o.next(fr) * ad(u, 0.004, 0.22, 3) * 0.22 * acc);
  }
  // a blip as each pulse of light (on her cable) leaves the top of the frame
  for (let n = GREEN; n < DURATION * FPS; n++) {
    const p = pulses(f(n));
    if (p.some((x) => x >= 0 && x < 1 / FPS / 0.42 - 1e-9)) {
      beep(m, f(n), midi(nn('E6')), 0.03, 0.035, 0.25, -0.2);
      beep(m, f(n) + 0.035, midi(nn('A6')), 0.03, 0.03, 0.25, -0.2);
    }
  }
}

/** The eyes: her sub drop and shine, the pings of the other two, the chime on the last beat. */
function wake(m: Mix): void {
  const at = f(WAKE_AT.mid);
  let ph = 0;
  m.add(at, 0.7, 0, (_i, t) => Math.sin((ph += (2 * Math.PI * (95 * Math.pow(0.45, t / 0.7))) / SR)) * ad(t, 0.004, 0.7, 2.5) * 0.35);
  shing(m, at + f(2), midi(nn('C7')));
  ping(m, at + f(2), midi(nn('E6')), 0.6, 0.05, 0);
  for (const [who, nt, pan] of [['left', 'G6', -0.4], ['right', 'B6', 0.4]] as const) {
    const t = f(WAKE_AT[who]) + f(2);
    shing(m, t, midi(nn(nt)) * 2);
    ping(m, t, midi(nn(nt)), 0.5, 0.06, pan);
  }
  kick(m, f(FINALE[0]), 1);
  chime(m, f(FINALE[0]));
}

export function soundtrack(_voices: VoiceClip[]): Stereo {
  resetNoise();
  const m = new Mix(DURATION + 0.05);
  bed(m);
  plug(m);
  power(m);
  wake(m);
  fadeTail(m, DURATION, 0.2);
  return m;
}
