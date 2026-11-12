// Quote cards: one real exchange from a chat as a still, for X (wide, 1920x1080) and Telegram (square, 1080x1080),
// each composed for its shape. The game's chat screen, re-set for a feed: the room of the chat (its theme), the
// partner on its pedestal with its gamertag, two to four lines as the game's bubbles (the player's on the right, the
// partner's on the left), the logo small, the question large, and "Find out at realsies.lol" with the URL in gold.
// Nothing on it gives the answer away: no verdict, no persona, no model.
//   wide    a HUD-like black band on top (the logo, the question); the room under it: the partner on the left as on a
//           wide screen, the bubbles in the column on the right; the line to the site at the foot
//   square  the room as on a phone: the partner at the top left, the logo and the question beside it where the
//           game's info box sits, the bubbles across the width under them; the line to the site at the foot
// The bubble text is never shrunk below 7 output px per font px (cap height 49 px, readable with the image 400 px
// wide): a card whose lines do not fit at that size is refused (QuoteFitError), not squeezed.

import { type Rgba, type ThemeId, type ChatLayout, type Rect, createBuffer, Rig, layoutChat, SceneRenderer, getThemeKit } from '../../art.ts';
import { blitK, rectOut } from '../../engine/camera.ts';
import { bubbleMetrics, bubbleStyles, drawBubble, type BubbleMetrics, type BubbleStyle } from '../../engine/chat.ts';
import { drawRuns, drawText, textW, type Style } from './text.ts';
import { P, dim, even, hexC } from './ui.ts';
import { logo, LOGO_W, LOGO_H } from './hero.ts';
import { wrapBalanced } from './botorhuman.ts';

export type CardShape = 'wide' | 'square';
export const CARD_SIZES: Record<CardShape, { w: number; h: number }> = { wide: { w: 1920, h: 1080 }, square: { w: 1080, h: 1080 } };

/** One line of the exchange, as it is drawn (already checked against the pixel font). */
export interface QuoteLine {
  from: 'me' | 'them';
  text: string;
}

export interface QuoteOpts {
  theme: ThemeId;
  partner: { name: string; seed: string };
  lines: QuoteLine[];
  /** "Human or bot?" */
  question: string;
  /** "Find out at" (white), then the URL (gold). */
  cta: string;
  url: string;
}

/** The lines do not fit at a readable size. */
export class QuoteFitError extends Error {}

/** Bubble text scales to try, largest first: never below 7 (cap height 49 px). */
const BUBBLE_K: Record<CardShape, number[]> = { wide: [8, 7], square: [8, 7] };
/** Space between a bubble and the column's side. */
const INSET = 12;

const TITLE = (scale: number): Style => ({ color: P.cream, scale, outline: P.black, extrude: P.tan });
const GOLD = (scale: number): Style => ({ color: P.gold, scale, outline: P.black, extrude: P.rust });
const WHITE = (scale: number): Style => ({ color: P.white, scale, outline: P.black });

interface Geo {
  /** Room pixel size (output px per game px) and the room buffer's top in output px. */
  S: number;
  top: number;
  orientation: 'landscape' | 'portrait';
  /** Where the bubbles may go (output px). */
  box: { x: number; y: number; w: number; h: number };
  /** Share of the column a bubble may take (the rest staggers the two sides). */
  share: number;
}

export interface BubbleLayout {
  k: number;
  rows: string[][];
  sizes: { w: number; h: number }[];
  /** Top of each bubble in the card (output px). */
  ys: number[];
}

export class QuoteCard {
  readonly w: number;
  readonly h: number;
  private g: Geo;
  private rig: Rig;
  private layout: ChatLayout;
  private label: number;
  private bs: { me: BubbleStyle; them: BubbleStyle };
  readonly bubbles: BubbleLayout;

  constructor(private o: QuoteOpts, readonly shape: CardShape) {
    const { w, h } = CARD_SIZES[shape];
    this.w = w;
    this.h = h;
    if (o.lines.length < 2 || o.lines.length > 4) throw new QuoteFitError(`a quote card shows two to four lines, not ${o.lines.length}`);
    this.g = GEO[shape]();
    const g = this.g;
    const gw = Math.ceil(w / g.S), gh = Math.ceil((h - g.top) / g.S);
    this.layout = layoutChat(gw, gh, { cssPx: g.S, orientation: g.orientation }) as ChatLayout;
    this.rig = new Rig(o.partner.seed);
    this.rig.lookToward(1);
    this.label = hexC(getThemeKit(o.theme).colors.labelText);
    const st = bubbleStyles(o.theme);
    this.bs = { me: st.me, them: st.them };
    this.bubbles = this.fit();
  }

  /** Room rect (game px) to card px. */
  private R(r: Rect): { x: number; y: number; w: number; h: number } {
    const S = this.g.S;
    return { x: r.x * S, y: r.y * S + this.g.top, w: r.w * S, h: r.h * S };
  }

  /** The largest bubble scale at which every line fits the box; else a QuoteFitError naming the problem. */
  private fit(): BubbleLayout {
    const box = this.g.box;
    const why: string[] = [];
    for (const k of BUBBLE_K[this.shape]) {
      const m = bubbleMetrics(k);
      const max = Math.floor(((box.w - 2 * INSET) * this.g.share - 2 * m.padX) / k);
      const rows = this.o.lines.map((l) => wrapBalanced(l.text, max));
      const wide = rows.flat().find((r) => textW(r) > max);
      if (wide) {
        why.push(`at ${k}: the word ${JSON.stringify(wide.split(' ').find((x) => textW(x) > max) ?? wide)} is wider than a bubble`);
        continue;
      }
      const up = (v: number) => Math.ceil(v / k) * k;
      const sizes = rows.map((r) => ({ w: up(Math.max(...r.map(textW)) * k + 2 * m.padX), h: up(m.padTop + r.length * m.lineH + (r.length - 1) * m.lineGap + m.padBottom) }));
      // the last tail hangs 5 bubble px under its bubble
      const total = sizes.reduce((a, s) => a + s.h, 0) + (sizes.length - 1) * m.gap + 5 * k;
      if (total > box.h) {
        why.push(`at ${k}: ${rows.map((r) => r.length).join('+')} rows need ${total} px, the ${this.shape} card has ${box.h}`);
        continue;
      }
      // centred in the box
      let y = box.y + even((box.h - total) / 2);
      const ys = sizes.map((s) => {
        const at = y;
        y += s.h + m.gap;
        return at;
      });
      return { k, rows, sizes, ys };
    }
    throw new QuoteFitError(`the lines do not fit the ${this.shape} card at a readable size (${why.join('; ')}); choose shorter lines or fewer`);
  }

  /** A moment when the partner's eyes are open and it looks toward the chat. */
  private stillNow(): number {
    let fallback = -1;
    for (let t = 400; t < 30000; t += 40) {
      const p = this.rig.pose(t);
      if (p.blink || p.mouthOpen) continue;
      if (p.look === 1) return t;
      if (fallback < 0 && p.look === 0) fallback = t;
    }
    return Math.max(0, fallback);
  }

  render(out: Rgba): void {
    const g = this.g, L = this.layout;
    const now = this.stillNow();
    const room = new SceneRenderer(this.o.theme, L).render({ now, partner: this.rig });
    blitK(out, room, 0, g.top, g.S);
    if (this.shape === 'wide') this.wideFrame(out);
    else this.squareFrame(out);
    this.tag(out);
    this.drawBubbles(out);
  }

  /** The gamertag on a black tag under the pedestal (as the game's, larger). */
  private tag(out: Rgba): void {
    const L = this.layout;
    const lab = this.R(L.partner.label);
    const ped = this.R(L.partner.pedestal);
    const s = this.shape === 'wide' ? 6 : 5;
    const tw = textW(this.o.partner.name) * s;
    const w = tw + 6 * s, h = 7 * s + 4 * s;
    const x = even(ped.x + ped.w / 2 - w / 2), y = even(lab.y);
    rectOut(out, x - 4, y - 4, w + 8, h + 8, P.black);
    rectOut(out, x, y, w, h, P.black);
    rectOut(out, x, y, w, 4, P.navyDark);
    drawText(out, this.o.partner.name, x + 3 * s, y + 2 * s + 2, { color: this.label, scale: s });
  }

  private drawBubbles(out: Rgba): void {
    const { k, rows, sizes, ys } = this.bubbles;
    const m: BubbleMetrics = bubbleMetrics(k);
    const box = this.g.box;
    this.o.lines.forEach((l, i) => {
      const st = l.from === 'me' ? this.bs.me : this.bs.them;
      const { w, h } = sizes[i];
      const x = l.from === 'me' ? box.x + box.w - INSET - w : box.x + INSET;
      drawBubble(out, st, m, x, ys[i], w, h, [], 0);
      rows[i].forEach((row, r) => drawText(out, row, x + m.padX, ys[i] + m.padTop + r * (m.lineH + m.lineGap), { color: st.text, scale: k }));
    });
  }

  /**
   * "Find out at realsies.lol" (the lead-in white, the URL gold) centred in the foot band at `top`, `h` tall under its
   * 4-px navy line: the outline reaches one font px above the caps, the extrusion and outline two below.
   */
  private cta(out: Rgba, cx: number, top: number, h: number, s: number): void {
    const lead = this.o.cta + ' ';
    const w = (textW(lead) + textW(this.o.url)) * s;
    const x = even(cx - w / 2);
    const y = top + 4 + even((h - 4 - 10 * s) / 2) + s;
    drawText(out, lead, x, y, WHITE(s));
    drawText(out, this.o.url, x + textW(lead) * s, y, GOLD(s));
  }

  // ---------------------------------------------------------------- wide

  /** A black band across the card (as the game's HUD), its inner edge lined in navy. */
  private band(out: Rgba, y: number, h: number, edge: 'top' | 'bottom'): void {
    rectOut(out, 0, y, this.w, h, P.black);
    rectOut(out, 0, edge === 'bottom' ? y + h - 4 : y, this.w, 4, P.navyDark);
  }

  private wideFrame(out: Rgba): void {
    const HB = WIDE_HB;
    // the top band: the logo small, the question large
    this.band(out, 0, HB, 'bottom');
    const lk = 4, qs = 13;
    const lw = LOGO_W * lk, qw = textW(this.o.question) * qs;
    const gap = 64;
    const x0 = even((this.w - (lw + gap + qw)) / 2);
    logo(out, x0, even((HB - LOGO_H * lk) / 2) - 4, lk);
    drawText(out, this.o.question, x0 + lw + gap, even((HB - 9 * qs) / 2) + 4, TITLE(qs));
    // the foot: the line to the site
    this.band(out, this.h - WIDE_FOOT, WIDE_FOOT, 'top');
    this.cta(out, this.w / 2, this.h - WIDE_FOOT, WIDE_FOOT, 9);
  }

  // ---------------------------------------------------------------- square

  private squareFrame(out: Rgba): void {
    // beside the partner, where the game's info box sits: the logo small, the question large on two rows
    const x0 = SQ_SIDE.x, x1 = SQ_SIDE.x1, cx = (x0 + x1) / 2;
    const lk = 3, qs = 12;
    const rows = twoRows(this.o.question);
    logo(out, even(cx - (LOGO_W * lk) / 2), SQ_SIDE.y, lk);
    let y = SQ_SIDE.y + LOGO_H * lk + 34;
    for (const r of rows) {
      drawText(out, r, even(cx - (textW(r) * qs) / 2), y, TITLE(qs));
      y += 10 * qs;
    }
    this.band(out, this.h - SQ_FOOT, SQ_FOOT, 'top');
    this.cta(out, this.w / 2, this.h - SQ_FOOT, SQ_FOOT, 7);
  }
}

/** A short line on two rows, broken at the space that keeps the wider row narrowest. */
function twoRows(text: string): string[] {
  const w = text.split(' ');
  let best = [text], bw = textW(text);
  for (let i = 1; i < w.length; i++) {
    const rows = [w.slice(0, i).join(' '), w.slice(i).join(' ')];
    const m = Math.max(...rows.map(textW));
    if (m < bw) [best, bw] = [rows, m];
  }
  return best;
}

const WIDE_HB = 176;
const WIDE_FOOT = 128;
const SQ_FOOT = 104;
/** The square's block beside the partner (logo and question). */
const SQ_SIDE = { x: 350, x1: 1010, y: 30 };

const GEO: Record<CardShape, () => Geo> = {
  wide: () => {
    const S = 5, top = WIDE_HB - 14 * S;
    // the column right of the partner, between the band and the foot
    const x = 770, x1 = 1840;
    const y = WIDE_HB + 22, y1 = 1080 - WIDE_FOOT - 22;
    return { S, top, orientation: 'landscape', box: { x, y, w: x1 - x, h: y1 - y }, share: 0.84 };
  },
  square: () => {
    // the room's top bar above the card, as the game hides it under the HUD
    const S = 5, top = -14 * S;
    const y = 388, y1 = 1080 - SQ_FOOT - 18;
    return { S, top, orientation: 'portrait', box: { x: 76, y, w: 1004 - 76, h: y1 - y }, share: 0.9 };
  },
};
