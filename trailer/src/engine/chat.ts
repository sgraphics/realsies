// Dialogue as chat bubbles in the game's own pixel style: a nine-slice bubble and tail from the
// theme's UI kit, word-wrapped text typing in, bouncing typing dots. `drawBubble` and `drawDots`
// are the primitives (any layout can use them, e.g. the montage's chat column); `ChatOverlay` is
// the interview layout: one speaker's bubbles on the left, the other's on the right, stacking from
// the bottom of the picture and scrolling up, the oldest dissolving through the palette once
// there are more than three, the whole chat sliding away at `away`.

import { type Rgba, type Color, type ThemeId, createBuffer, nineSlice, blit, PAL, getThemeKit } from '../art.ts';
import { blitK, rectOut, OUT_W, OUT_H, BAR } from './camera.ts';
import { drawString, measure } from './font.ts';
import { lineShown, lineTimes, typedCount, type Line } from './timeline.ts';

/** Bubble metrics at scale k (bubble sprite px and font px are both k output px). */
export function bubbleMetrics(k: number) {
  return {
    k,
    padX: 5 * k,
    padTop: 3 * k,
    padBottom: 2 * k,
    lineH: 9 * k,
    lineGap: k,
    /** Typing-dots bubble. */
    dotsW: 24 * k,
    dotsH: 14 * k,
    /** Space under a bubble (its tail hangs 5k into it). */
    gap: 6 * k,
  };
}
export type BubbleMetrics = ReturnType<typeof bubbleMetrics>;

export interface BubbleStyle {
  ns: { img: Rgba; slice: number };
  tail: Rgba;
  /** Right-aligned: tail at the bottom right. */
  right: boolean;
  text: Color;
}

const flip = (src: Rgba) => {
  const b = createBuffer(src.w, src.h);
  blit(b, src, 0, 0, { flipX: true });
  return b;
};

/** The theme's two bubble styles, tails as in the game (them: left, me: right) or turned toward the speaker. */
export function bubbleStyles(theme: ThemeId): { them: BubbleStyle; me: BubbleStyle; themOnRight: BubbleStyle; meOnLeft: BubbleStyle } {
  const kit = getThemeKit(theme);
  const hexC = (h: string) => parseInt(h.slice(1), 16) as Color;
  return {
    them: { ns: kit.ui.bubbleThem, tail: kit.ui.tailThem, right: false, text: hexC(kit.colors.bubbleThemText) },
    me: { ns: kit.ui.bubbleMe, tail: kit.ui.tailMe, right: true, text: hexC(kit.colors.bubbleMeText) },
    themOnRight: { ns: kit.ui.bubbleThem, tail: flip(kit.ui.tailThem), right: true, text: hexC(kit.colors.bubbleThemText) },
    meOnLeft: { ns: kit.ui.bubbleMe, tail: flip(kit.ui.tailMe), right: false, text: hexC(kit.colors.bubbleMeText) },
  };
}

/**
 * Word wrap to at most `max` font px per row, in as few rows as a greedy wrap needs, then balanced:
 * of the ways to break into that many rows, the one whose widest row is narrowest (no orphans).
 */
export function wrapText(text: string, max: number): string[] {
  const words = text.split(' ');
  const greedy: string[] = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (!cur || measure(cand) <= max) cur = cand;
    else {
      greedy.push(cur);
      cur = w;
    }
  }
  if (cur) greedy.push(cur);
  const n = greedy.length;
  let best = greedy, bestW = Math.max(...greedy.map(measure));
  const split = (i: number, rows: string[]): void => {
    if (rows.length === n - 1) {
      const all = [...rows, words.slice(i).join(' ')];
      const w = Math.max(...all.map(measure));
      if (w < bestW) [best, bestW] = [all, w];
      return;
    }
    for (let j = i + 1; j <= words.length - (n - 1 - rows.length); j++) {
      const row = words.slice(i, j).join(' ');
      if (measure(row) > max) break;
      split(j, [...rows, row]);
    }
  };
  if (n > 1) split(0, []);
  return best;
}

/** Output size of a bubble holding `rows`. */
export function bubbleSize(rows: string[], m: BubbleMetrics): { w: number; h: number } {
  const up = (v: number) => Math.ceil(v / m.k) * m.k;
  return {
    w: up(Math.max(...rows.map(measure)) * m.k + m.padX * 2),
    h: up(m.padTop + rows.length * m.lineH + (rows.length - 1) * m.lineGap + m.padBottom),
  };
}

function frame(out: Rgba, st: BubbleStyle, m: BubbleMetrics, x: number, y: number, w: number, h: number, dark: number): void {
  // compose at bubble-pixel scale for the frame and tail, then the text on top at output scale
  const bw = Math.round(w / m.k), bh = Math.round(h / m.k);
  const b = createBuffer(bw, bh + 5);
  nineSlice(b, st.ns.img, st.ns.slice, 0, 0, bw, bh);
  blit(b, st.tail, st.right ? bw - 9 : 2, bh - 1);
  blitK(out, b, x, y, m.k, { dark });
}

/** A bubble with `rows` of text, the first `typed` characters shown (the row breaks eat a space each). */
export function drawBubble(out: Rgba, st: BubbleStyle, m: BubbleMetrics, x: number, y: number, w: number, h: number, rows: string[], typed: number, dark = 0): void {
  frame(out, st, m, x, y, w, h, dark);
  if (dark) return;
  let n = typed;
  rows.forEach((row, r) => {
    if (n <= 0) return;
    drawString(out, row, x + m.padX, y + m.padTop + r * (m.lineH + m.lineGap), { color: st.text, scale: m.k }, Math.min(n, row.length));
    n -= row.length + 1;
  });
}

/** The typing-dots bubble: three square dots, one hopping at a time (`age` seconds since the dots began). */
export function drawDots(out: Rgba, st: BubbleStyle, m: BubbleMetrics, x: number, y: number, h: number, age: number, dark = 0): void {
  frame(out, st, m, x, y, m.dotsW, h, dark);
  if (h < m.dotsH * 0.66) return; // still growing in
  const hop = Math.floor(age / 0.14) % 3;
  const even = (v: number) => 2 * Math.round(v / 2);
  const s = even(2.4 * m.k), step = even(4.4 * m.k), lift = even(1.2 * m.k);
  const top = y + even((m.dotsH - s) / 2);
  for (let d = 0; d < 3; d++) {
    rectOut(out, x + 6 * m.k + d * step, top - (d === hop ? lift : 0), s, s, d === hop ? PAL.navy : PAL.slate);
  }
}

// ---------------------------------------------------------------- the interview layout

export interface ChatConfig {
  /** Game theme whose bubble kit is used. */
  theme: ThemeId;
  /** The chat lines, in order (speaker host on the left, guest on the right). */
  lines: Line[];
  /** When the chat slides away. */
  away: number;
  /** Bubble and text scale (output px per pixel) and the wrap width in font px. */
  k: number;
  wrap: number;
}

const MARGIN = 48;
const BOTTOM = OUT_H - BAR - 28;
const VISIBLE = 3;
/** The oldest bubble's dissolve: three darker palette steps over this long, then gone. */
const DISSOLVE = 0.225;
/** The slide away at the end. */
const AWAY = 0.32;
const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

interface Item {
  line: Line;
  rows: string[];
  w: number;
  h: number;
  from: number; // typing dots start
}

export class ChatOverlay {
  private items: Item[];
  private style: Record<'host' | 'guest', BubbleStyle>;
  private m: BubbleMetrics;

  constructor(private cfg: ChatConfig) {
    const s = bubbleStyles(cfg.theme);
    // her bubbles are the partner's grey ones, his the player's cyan; tails turned toward the speaker
    this.style = { guest: s.themOnRight, host: s.meOnLeft };
    this.m = bubbleMetrics(cfg.k);
    this.items = cfg.lines.map((line) => {
      const rows = wrapText(lineShown(line), cfg.wrap);
      const { w, h } = bubbleSize(rows, this.m);
      return { line, rows, w, h, from: line.at - (line.lead ?? 0.7) };
    });
  }

  /** When a line's typing dots appear and when its bubble has left the picture (for script.md). */
  span(line: Line): { from: number; until: number } {
    const i = this.items.findIndex((it) => it.line === line);
    if (i < 0) return { from: line.at, until: lineTimes(line).end };
    const slidOff = this.cfg.away + AWAY;
    const pushedOut = i + VISIBLE < this.items.length ? this.items[i + VISIBLE].from + DISSOLVE : Infinity;
    return { from: this.items[i].from, until: Math.min(slidOff, pushedOut) };
  }

  /** Draw the chat at time t over the picture (call before the letterbox bars). */
  draw(out: Rgba, t: number): void {
    const m = this.m;
    const away = ease((t - this.cfg.away) / AWAY);
    if (away >= 1) return;
    const live = this.items.filter((it) => t >= it.from);
    if (!live.length) return;
    // layout from the newest at the bottom up; a new item grows in and pushes the stack up
    const hs = live.map((it) => {
      const grow = ease((t - it.from) / 0.14);
      const full = t < it.line.at ? m.dotsH : m.dotsH + (it.h - m.dotsH) * ease((t - it.line.at) / 0.1);
      return full * grow;
    });
    let y = BOTTOM;
    const ys: number[] = [];
    for (let i = live.length - 1; i >= 0; i--) {
      y -= hs[i];
      ys[i] = y;
      y -= m.gap * Math.min(1, hs[i] / 20);
    }
    const drop = Math.round((away * away * 900) / 2) * 2;
    live.forEach((it, i) => {
      const age = live.length - 1 - i; // 0 = newest
      let dark = 0;
      if (age > VISIBLE) return;
      if (age === VISIBLE) {
        // the oldest dissolves as the newest arrives, then is gone
        const since = t - live[live.length - 1].from;
        if (since >= DISSOLVE) return;
        dark = 1 + Math.floor((since / DISSOLVE) * 3);
      }
      const st = this.style[it.line.speaker as 'host' | 'guest'];
      const typing = t < it.line.at;
      const w = typing ? m.dotsW : it.w;
      const h = Math.round(hs[i] / m.k) * m.k;
      if (h < m.k * 3) return;
      const x = st.right ? OUT_W - MARGIN - w : MARGIN;
      const by = Math.round(ys[i] / 2) * 2 + drop;
      if (typing) drawDots(out, st, m, x, by, Math.min(h, m.dotsH), t - it.from, dark);
      else drawBubble(out, st, m, x, by, w, h, it.rows, typedCount(it.line, t), dark);
    });
  }
}
