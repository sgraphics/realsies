// How you win, step by step and slowly, one thing at a time. YOU stand large in the bottom-right
// corner, the way your side of a chat sits. Your partner slides in from the left, labelled AI BOT or
// REAL HUMAN. You say your call; your coins fly into a treasure chest. Two more players slide in from
// the right and add theirs. ROUND REVEAL. A small table of everyone's calls: coins move from the
// rows that called it wrong to the rows that called it right. WIN, over you.
// The amounts come from the game's rules: 5% of a play to the bot fund, then the coins of the wrong
// calls split 70% to the right callers by the coins they played, 20% to the character (the Turing
// bonus), 10% to the game.

import { type Rgba, type Color, type Look, createBuffer, px, PAL, icon, lookFromSeed } from '../../art.ts';
import { blitK, rectOut, fillOut, OUT_W, OUT_H } from '../../engine/camera.ts';
import { bubbleStyles, bubbleMetrics, bubbleSize, drawBubble } from '../../engine/chat.ts';
import { JackActor, type EyeState } from '../jackin.ts';
import { drawText, drawTextC, drawRuns, textW, type Run, type Style } from './text.ts';
import { tag, ease, clamp01, even } from './ui.ts';
import { sky, logo, url, LOGO_W } from './hero.ts';

const P = PAL;
export type Side = 'human' | 'bot';
export const RULES = { fee: 0.05, right: 0.7, character: 0.2, game: 0.1 };

export interface Caller {
  name: string;
  call: Side;
  play: number;
  /** Rig seed (the other players); YOU use the scene's look. */
  seed?: string;
}

export interface Case {
  truth: Side;
  /** YOU first, then the two other players in the order they come in. */
  callers: Caller[];
}

/** Each caller's net result (fee included), the coins of the wrong calls, and the character's bonus. */
export function settle(c: Case): { net: number[]; wrong: number; bonus: number; game: number } {
  const onCall = c.callers.map((k) => k.play * (1 - RULES.fee));
  const right = c.callers.map((k) => k.call === c.truth);
  const wrong = onCall.reduce((a, v, i) => a + (right[i] ? 0 : v), 0);
  const rightSum = onCall.reduce((a, v, i) => a + (right[i] ? v : 0), 0);
  const net = c.callers.map((k, i) => (right[i] ? onCall[i] + (RULES.right * wrong * onCall[i]) / rightSum - k.play : -k.play));
  return { net, wrong, bonus: RULES.character * wrong, game: RULES.game * wrong };
}

export const fmt = (n: number) => (n >= 0 ? '+' : '−') + (Math.abs(n) % 1 < 0.05 || Math.abs(n) % 1 > 0.95 ? Math.round(Math.abs(n)).toString() : Math.abs(n).toFixed(1));

/** Seconds from the start of a case. */
export const T = {
  partnerIn: [0, 0.9],
  youCall: 1.2,
  youCoins: [1.7, 2.5],
  player: (i: number) => 2.9 + i * 1.6, // slides in; its bubble at +0.6, its coins fly +0.9 .. +1.5
  playersOut: [6.3, 6.8],
  reveal: 6.9,
  table: 8.3,
  marks: 8.9,
  move: [9.3, 10.3],
  win: 10.7,
  len: 12.75,
};

export interface HowWinConfig {
  you: Look;
  partners: Record<Side, { look: Look; bigEyes?: boolean }>;
  /** The chest's label. */
  chestLabel: string;
  title: string;
}

// layout (output px)
const K = 20; // the big characters
const YOU_CX = 1610, PARTNER_CX = 330;
const BIG_TOP = OUT_H - 34 * K; // waist on the bottom edge
const SMALL_K = 7;
const PLAYER_CX = [1360, 1740];
const SMALL_TOP = 350 - 34 * SMALL_K;
const CHEST = { cx: 960, y: 170, k: 8 };
const TABLE = { x: 570, y: 250, w: 780, rowH: 76 };

const coinIcon = icon('coin');

// ---------------------------------------------------------------- a treasure chest

function chestSprite(open: number): Rgba {
  // 26 x 20 px: lid (rows 0-6) over the box (rows 7-19); `open` lifts the lid a row and shows gold
  const b = createBuffer(26, 22);
  const lidUp = open > 0 ? 2 : 0;
  const wood = [P.clay, P.brownLight, P.brown, P.plum];
  for (let y = 9; y <= 21; y++)
    for (let x = 1; x <= 24; x++) {
      let c: Color = y === 9 ? wood[0] : y > 18 ? wood[2] : wood[1];
      if (y === 13 || y === 17) c = wood[2]; // planks
      px(b, x, y, c);
    }
  // gold bands and the lock
  for (let y = 9; y <= 21; y++) {
    px(b, 4, y, P.gold);
    px(b, 21, y, P.gold);
  }
  for (let x = 1; x <= 24; x++) px(b, x, 9, P.gold);
  for (const [x, y, c] of [[11, 10, P.yellow], [12, 10, P.yellow], [13, 10, P.yellow], [14, 10, P.yellow], [11, 11, P.gold], [12, 11, P.black], [13, 11, P.black], [14, 11, P.gold], [11, 12, P.gold], [12, 12, P.gold], [13, 12, P.gold], [14, 12, P.gold]] as [number, number, Color][]) px(b, x, y, c);
  // gold inside when open
  if (open > 0) for (let x = 3; x <= 22; x++) for (let y = 7; y <= 8; y++) px(b, x, y, (x + y) % 3 === 0 ? P.yellow : P.gold);
  // the lid, rounded
  for (let y = 2; y <= 8; y++) {
    const inset = y === 2 ? 3 : y === 3 ? 1 : 0;
    for (let x = 1 + inset; x <= 24 - inset; x++) {
      let c: Color = y < 4 ? wood[0] : y === 8 ? wood[2] : wood[1];
      if (x === 4 || x === 21) c = P.gold;
      px(b, x, y - lidUp, c);
    }
  }
  // outline
  const out = createBuffer(28, 24);
  for (let y = 0; y < 22; y++) for (let x = 0; x < 26; x++) {
    const i = (y * 26 + x) * 4;
    if (!b.data[i + 3]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) px(out, x + 1 + dx, y + 1 + dy, P.black);
  }
  for (let y = 0; y < 22; y++) for (let x = 0; x < 26; x++) {
    const i = (y * 26 + x) * 4;
    if (b.data[i + 3]) px(out, x + 1, y + 1, (b.data[i] << 16) | (b.data[i + 1] << 8) | b.data[i + 2]);
  }
  return out;
}

// ---------------------------------------------------------------- the scene

export class HowWinScene {
  private you: JackActor;
  private partner: Record<Side, JackActor>;
  private players = new Map<string, JackActor>();
  private bg: Rgba;
  constructor(private cfg: HowWinConfig) {
    this.you = new JackActor(cfg.you, false, 1, false);
    this.partner = {
      human: new JackActor(cfg.partners.human.look, !!cfg.partners.human.bigEyes, 1, false),
      bot: new JackActor(cfg.partners.bot.look, !!cfg.partners.bot.bigEyes, 1, false),
    };
    const k = 6;
    this.bg = sky({ w: OUT_W, h: OUT_H, k, stars: 0.006, tones: [P.black, P.black, P.navyDark] });
  }

  private player(seed: string): JackActor {
    let a = this.players.get(seed);
    if (!a) {
      a = new JackActor(lookFromSeed(seed), false, 1, false);
      this.players.set(seed, a);
    }
    return a;
  }

  private base(out: Rgba): void {
    fillOut(out, P.black);
    blitK(out, this.bg, 0, 0, 6);
    logo(out, 40, 28, 3, { sparkles: false });
    drawText(out, this.cfg.title, 40 + LOGO_W * 3 + 30, 40, { color: P.cream, scale: 6, outline: P.black });
  }

  private bubble(out: Rgba, text: string, rightX: number, bottomY: number, k: number, pop: boolean): void {
    const st = bubbleStyles('space').me;
    const m = bubbleMetrics(k);
    const sz = bubbleSize([text], m);
    drawBubble(out, st, m, even(rightX - sz.w), even(bottomY - sz.h - (pop ? k : 0)), sz.w, sz.h, [text], 99);
  }

  private flyCoins(out: Rgba, from: { x: number; y: number }, to: { x: number; y: number }, a: number, dur: number, n: number, k = 6): void {
    for (let i = 0; i < n; i++) {
      const t = clamp01((a - i * 0.06) / dur);
      if (t <= 0 || t >= 1) continue;
      const e = ease(t);
      const x = from.x + (to.x - from.x) * e + Math.sin(i * 2.1) * 24 * Math.sin(Math.PI * t);
      const y = from.y + (to.y - from.y) * e - 160 * Math.sin(Math.PI * t);
      blitK(out, coinIcon, even(x - (coinIcon.w * k) / 2), even(y - (coinIcon.h * k) / 2), k);
    }
  }

  /** Coins in the chest at time u. */
  private chestCoins(c: Case, u: number): number {
    let n = 0;
    if (u >= T.youCoins[1]) n += c.callers[0].play;
    for (let i = 1; i < c.callers.length; i++) if (u >= T.player(i - 1) + 1.5) n += c.callers[i].play;
    return n;
  }

  render(out: Rgba, c: Case, u: number, last = false): void {
    this.base(out);
    const s = settle(c);
    const youWin = s.net[0];

    // ---- the chest and its label, until the table takes over
    if (u < T.table) {
      const coins = this.chestCoins(c, u);
      const spr = chestSprite(coins);
      const x = even(CHEST.cx - (spr.w * CHEST.k) / 2);
      blitK(out, spr, x, CHEST.y, CHEST.k);
      drawTextC(out, this.cfg.chestLabel, CHEST.cx, CHEST.y + spr.h * CHEST.k + 16, { color: P.gold, scale: 6, outline: P.black });
      if (coins > 0) {
        const t = `${coins} coins`;
        drawTextC(out, t, CHEST.cx, CHEST.y - 52, { color: P.white, scale: 5, outline: P.black });
      }
    }

    // ---- the two other players, small, upper right: slide in, call, coins to the chest, slide out
    c.callers.slice(1).forEach((k, i) => {
      const t0 = T.player(i);
      if (u < t0 || !k.seed) return;
      const inX = 1 - ease(clamp01((u - t0) / 0.5));
      const outX = ease(clamp01((u - T.playersOut[0]) / (T.playersOut[1] - T.playersOut[0])));
      const cx = PLAYER_CX[i] + (inX + outX) * 700;
      if (cx > OUT_W + 200) return;
      const a = this.player(k.seed);
      blitK(out, a.frame({ eyes: 'open', jolt: 0, lit: false }), even(cx - 16 * SMALL_K), SMALL_TOP, SMALL_K);
      const tw = textW(k.name) * 4 + 16;
      tag(out, k.name, even(cx - tw / 2), SMALL_TOP + 2 * SMALL_K - 20, { bg: P.slate, fg: P.white, scale: 4, padX: 8 });
      if (u >= t0 + 0.6 && u < T.playersOut[0]) this.bubble(out, k.call === 'human' ? 'Human!' : 'Bot!', cx + 70, SMALL_TOP - 26, 5, u - t0 - 0.6 < 0.08);
      this.flyCoins(out, { x: cx, y: SMALL_TOP + 220 }, { x: CHEST.cx, y: CHEST.y + 90 }, u - t0 - 0.9, 0.6, 4, 5);
    });

    // ---- the partner slides in from the left, labelled
    const pin = 1 - ease(clamp01((u - T.partnerIn[0]) / (T.partnerIn[1] - T.partnerIn[0])));
    const pcx = PARTNER_CX - pin * 800;
    const r = u - T.reveal;
    const botEyes: EyeState = r < 0.3 ? 'open' : r < 0.38 ? 'glow' : r < 0.46 ? 'open' : 'glow';
    const partner = this.partner[c.truth];
    blitK(out, partner.frame({ eyes: c.truth === 'bot' ? botEyes : 'open', jolt: 0, lit: false }), even(pcx - 16 * K), BIG_TOP, K);
    {
      const isBot = c.truth === 'bot';
      const text = isBot ? 'AI BOT' : 'REAL HUMAN';
      const ic = icon(isBot ? 'bot' : 'user');
      const sc = 7;
      const w = textW(text) * sc + 2 * 2 * sc + ic.w * Math.round(sc * 0.75) + sc;
      tag(out, text, even(pcx - w / 2), BIG_TOP + 30 - (sc - 7) * 6, { bg: isBot ? P.cyan : P.lime, fg: P.black, scale: sc, icon: ic });
    }

    // ---- YOU, big in the bottom-right corner; a hop when you win
    const hop = u >= T.win && u < T.win + 0.3 ? -Math.round(Math.sin(((u - T.win) / 0.3) * Math.PI) * 40) : 0;
    blitK(out, this.you.frame({ eyes: 'open', jolt: 0, lit: false }), even(YOU_CX - 16 * K), BIG_TOP + hop, K);
    {
      const tw = textW('YOU') * 7 + 28;
      tag(out, 'YOU', even(YOU_CX - tw / 2), BIG_TOP + 30 + hop, { bg: P.gold, fg: P.black, scale: 7, padX: 14 });
    }
    // your call, then your coins to the chest
    if (u >= T.youCall && u < T.reveal) this.bubble(out, c.callers[0].call === 'human' ? 'Human!' : 'Bot!', YOU_CX - 170, BIG_TOP + 190, 9, u - T.youCall < 0.08);
    this.flyCoins(out, { x: YOU_CX - 120, y: BIG_TOP + 560 }, { x: CHEST.cx, y: CHEST.y + 90 }, u - T.youCoins[0], T.youCoins[1] - T.youCoins[0], 5);

    // ---- the reveal
    if (r >= 0 && u < T.table) {
      const sc = r < 0.08 ? 11 : 10;
      drawTextC(out, 'ROUND REVEAL', 960, 540 - (sc - 10) * 4, { color: P.gold, scale: sc, outline: P.black, extrude: P.orange });
      if (r >= 0.4) drawTextC(out, c.truth === 'bot' ? 'Your partner was an AI bot' : 'Your partner was a real human', 960, 680, { color: P.white, scale: 5, outline: P.black });
    }

    // ---- the table of calls, and the coins moving from the wrong rows to the right ones
    if (u >= T.table) this.table(out, c, s, u);

    // ---- WIN over you
    if (u >= T.win) {
      const a = u - T.win;
      const sc = a < 0.06 ? 14 : a < 0.12 ? 12 : 11;
      drawTextC(out, 'WIN', 1600, 40 - (sc - 11) * 4, { color: P.lime, scale: sc, outline: P.black, extrude: P.green });
      const amt = `${fmt(youWin)} coins`;
      drawTextC(out, amt, 1600, 150, { color: P.gold, scale: 8, outline: P.black, extrude: P.orange });
    }
    void last;
  }

  private table(out: Rgba, c: Case, s: ReturnType<typeof settle>, u: number): void {
    const a = u - T.table;
    const cols = [{ h: 'PLAYER', w: 230 }, { h: 'CALL', w: 190 }, { h: 'COINS', w: 140 }, { h: 'RESULT', w: 150 }];
    const x0 = TABLE.x, y0 = TABLE.y, rows = c.callers.length;
    const H = TABLE.rowH * (rows + 1) + 20;
    const reveal = ease(clamp01(a / 0.3));
    const hh = Math.round(H * reveal);
    rectOut(out, x0 - 6, y0 - 6, TABLE.w + 12, hh + 12, P.black);
    rectOut(out, x0, y0, TABLE.w, hh, P.navyDark);
    rectOut(out, x0, y0, TABLE.w, Math.min(hh, 6), P.slate);
    if (reveal < 1) return;
    const colX: number[] = [];
    cols.reduce((x, col) => (colX.push(x), x + col.w), x0 + 24);
    const st = (color: Color): Style => ({ color, scale: 5 });
    cols.forEach((col, i) => drawText(out, col.h, colX[i], y0 + 26, { color: P.greyLight, scale: 4 }));
    const rowY = (i: number) => y0 + 20 + TABLE.rowH * (i + 1);
    const right = c.callers.map((k) => k.call === c.truth);
    const moved = clamp01((u - T.move[0]) / (T.move[1] - T.move[0]));
    c.callers.forEach((k, i) => {
      const y = rowY(i);
      if (i === 0) rectOut(out, x0 + 8, y - 16, TABLE.w - 16, TABLE.rowH - 8, P.navy);
      drawText(out, k.name, colX[0], y, st(i === 0 ? P.gold : P.white));
      drawText(out, k.call === 'human' ? 'Human' : 'Bot', colX[1], y, st(k.call === 'human' ? P.lime : P.cyan));
      // the coins played: a wrong row's coins leave as they move
      const left = right[i] ? k.play : Math.round(k.play * (1 - moved));
      if (u < T.move[0] || right[i] || left > 0) drawText(out, String(left), colX[2], y, st(P.white));
      // marks, then the results counting in
      if (u >= T.marks) drawText(out, right[i] ? '✓' : '×', x0 + TABLE.w - 50, y, { color: right[i] ? P.lime : P.red, scale: 6 });
      if (u >= T.move[0]) {
        const v = s.net[i] * ease(moved);
        drawText(out, fmt(v), colX[3], y, st(right[i] ? P.gold : P.red));
      }
    });
    // coins in flight from each wrong row's COINS to each right row's RESULT
    if (u >= T.move[0] && u < T.move[1] + 0.3)
      c.callers.forEach((_k, i) => {
        if (right[i]) return;
        c.callers.forEach((_j, j) => {
          if (!right[j]) return;
          this.flyCoins(out, { x: colX[2] + 30, y: rowY(i) + 14 }, { x: colX[3] + 40, y: rowY(j) + 14 }, u - T.move[0] - (i + j) * 0.05, 0.7, 3, 4);
        });
      });
    // where the rest goes
    if (u >= T.move[1]) {
      const who = c.truth === 'bot' ? "the bot's builder" : 'the human';
      const lines: Run[][] = [
        [{ text: 'Coins of wrong calls go ' }, { text: '70%', color: P.gold }, { text: ' to right calls,' }],
        [{ text: '20%', color: P.gold }, { text: ` to ${who}, ` }, { text: '10%', color: P.gold }, { text: ' to the game.' }],
      ];
      lines.forEach((l, i) => drawTextC(out, l, x0 + TABLE.w / 2, y0 + H + 30 + i * 40, { color: P.greyLight, scale: 3, outline: P.black }));
    }
  }

  outro(out: Rgba, u: number, lines: Run[][]): void {
    fillOut(out, P.black);
    blitK(out, this.bg, 0, 0, 6);
    const lk = 10;
    logo(out, even(960 - (LOGO_W * lk) / 2), 90, lk, { glint: u < 0.6 ? Math.round(-12 + (u / 0.6) * 90) : 44 });
    lines.forEach((l, i) => {
      if (u < 0.3 + i * 0.5) return;
      drawTextC(out, l, 960, 500 + i * 120, { color: P.white, scale: 8, outline: P.black, extrude: P.slate });
    });
    if (u >= 1.3) url(out, 'realsies.lol', 960, 820, 10);
  }
}
