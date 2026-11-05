// Generic timeline pieces every variant's storyboard is made of: shots with framings and push-ins,
// typed lines (dialogue, cards) with their per-character timing.

export interface Framing {
  /** World point at the centre of the frame and output pixels per world pixel. */
  cx: number;
  cy: number;
  k: number;
  /** wide = full detail and the foreground camera; tight = defocused room behind the faces. */
  lens: 'wide' | 'tight';
}

/** A slow push-in: from one framing to another in whole-number (even) zoom steps. */
export interface Push {
  from: Framing;
  to: Framing;
  t0: number;
  t1: number;
}

export interface Shot {
  id: string;
  /** Which scene draws it (the variant maps kinds to scenes). */
  kind: string;
  start: number;
  end: number;
  /** Shot list line for script.md. */
  title: string;
  notes: string;
  framing?: Framing;
  push?: Push;
  /** Fade in from black over this many seconds (palette steps). */
  fadeIn?: number;
  fadeOut?: number;
  /** Time used for the contact sheet (absolute). */
  key: number;
}

export function shotAt(shots: Shot[], t: number): Shot {
  for (const s of shots) if (t >= s.start && t < s.end) return s;
  return shots[shots.length - 1];
}

const easeInOut = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** The framing of a shot at time t: fixed, or along its push-in in even zoom steps. */
export function framingAt(s: Shot, t: number): Framing {
  if (!s.push) return s.framing!;
  const p = s.push;
  const u = easeInOut((t - p.t0) / (p.t1 - p.t0));
  const k = Math.round((p.from.k + (p.to.k - p.from.k) * u) / 2) * 2;
  // keep the target point fixed on screen as the zoom steps: interpolate the centre by zoom, not time
  const z = (k - p.from.k) / (p.to.k - p.from.k);
  return { cx: p.from.cx + (p.to.cx - p.from.cx) * z, cy: p.from.cy + (p.to.cy - p.from.cy) * z, k, lens: p.to.lens };
}

// ---------------------------------------------------------------- typed lines

export type Speaker = 'host' | 'guest';

export interface Line {
  /** Voice file id: variants/<name>/voice/<id>.wav plays from this line's start. */
  id: string;
  speaker: Speaker | 'card' | 'tagline';
  /** Shown verbatim; '|' marks a held pause while typing (not shown). */
  text: string;
  /** When the text starts typing (into its bubble, card or end card). */
  at: number;
  /** Characters per second while typing. */
  cps: number;
  /** Seconds of typing dots before the bubble (chat lines). */
  lead?: number;
  /** Seconds a '|' pause holds (default 0.55). */
  pause?: number;
  /** Semitone offsets per character for a synthesised blip voice (optional). */
  tune?: number[];
}

export const DEFAULT_PAUSE = 0.55;

/** Timeline of a line: when each visible character appears (pauses applied). */
export function lineTimes(l: Line): { chars: string[]; times: number[]; end: number } {
  const chars: string[] = [];
  const times: number[] = [];
  let t = l.at;
  for (const ch of l.text) {
    if (ch === '|') {
      t += l.pause ?? DEFAULT_PAUSE;
      continue;
    }
    chars.push(ch);
    times.push(t);
    t += 1 / l.cps;
  }
  return { chars, times, end: t };
}

/** Characters of a line visible at time t. */
export function typedCount(l: Line, t: number): number {
  const { times } = lineTimes(l);
  let n = 0;
  while (n < times.length && times[n] <= t) n++;
  return n;
}

export function lineShown(l: Line): string {
  return l.text.replace(/\|/g, '');
}

/** A music grid: absolute time of a beat counted from a downbeat. */
export function beatGrid(bpm: number, downbeat: number): { beatLen: number; beat: (n: number) => number } {
  const beatLen = 60 / bpm;
  return { beatLen, beat: (n: number) => downbeat + n * beatLen };
}
