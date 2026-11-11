// "Bot or human?": one real chat as a short clip, in the game's own look, in two shapes, each composed for its
// shape (neither is cropped from the other): wide 1920x1080 for X, tall 1080x1920 for TikTok, Shorts, Reels and
// Telegram. Five parts:
//   hook    "Bot or human?" over the chat room
//   chat    the game's chat screen (landscape or portrait layout from the engine): the partner on its pedestal, the
//           info box, the HUD with the chat clock, the player's lines typed into the input and sent as bubbles, the
//           partner's typing dots, then its bubbles; bigger than the app so they read on a phone
//   pause   the call room, "Human or bot?" and the game's 3-2-1 countdown art
//   reveal  BOT (or HUMAN) stamped, the persona card the game reveals (name, age, job, home), the model, and for a
//           bot the line about signatures in a NEAR AI enclave
//   end     the trailer's sunrise and smug three, the logo, the question, the URL, "First chat is free"
// The tall shape keeps everything that must be read between y 150 and 1500 and away from the right edge, where
// TikTok, Shorts and Reels lay their buttons and captions. A variant supplies the chat, the reveal and every time
// (variants/bot-or-human/).

import { type Rgba, type Color, type Look, type ThemeId, type ChatLayout, type CallLayout, createBuffer, Rig, layoutChat, layoutCall, SceneRenderer, getThemeKit, countdownSprite, icon, drawLogo, LOGO_W, LOGO_H } from '../../art.ts';
import { renderPortrait } from '../../promo-art.ts';
import { blitK, rectOut } from '../../engine/camera.ts';
import { bubbleMetrics, bubbleStyles, drawBubble, drawDots, type BubbleMetrics, type BubbleStyle } from '../../engine/chat.ts';
import { drawText, drawTextC, drawRuns, textW, wrap, type Run, type Style } from './text.ts';
import { P, S, O, TOP, HUD_H, nine, dim, hud, nameTag, tag, pillW, ease, even, clamp01, hexC, ms, type HudStat, type Kit } from './ui.ts';
import { sky, crest, logo, url, Trio } from './hero.ts';

export type Format = 'wide' | 'tall';
export const SIZES: Record<Format, { w: number; h: number }> = { wide: { w: 1920, h: 1080 }, tall: { w: 1080, h: 1920 } };

/** One line of the chat as the clip shows it. */
export interface ClipMsg {
  from: 'me' | 'them';
  text: string;
  /** me: typing into the input starts; them: the typing dots start. */
  typeFrom: number;
  /** The bubble lands. */
  at: number;
}

/** Who a bot was playing: the persona card the game reveals (shared/protocol.ts PersonaCard, the fields shown here). */
export interface RevealCard {
  name?: string;
  age?: number;
  gender?: string;
  mbti?: string;
  temperament?: string;
  job?: string;
  home?: string;
}

export interface ClipTimes {
  /** The hook ends and the chat screen begins. */
  hookTo: number;
  /** The chat ends and the pause begins. */
  chatTo: number;
  /** The 3, 2 and 1. */
  count: [number, number, number];
  /** The reveal: the panel, the stamp, the persona card, the proof line. */
  revealFrom: number;
  stamp: number;
  card: number;
  proof: number;
  /** The end card: in, the URL, "First chat is free", the last frame. */
  endFrom: number;
  url: number;
  free: number;
  out: number;
}

export interface ClipConfig {
  theme: ThemeId;
  /** The level plate in the HUD, e.g. STAR STATION. */
  level: string;
  partner: { name: string; seed: string };
  /** A free chat (the practice chat, or a free seat) or a play of coins. */
  coins: number;
  chat: ClipMsg[];
  /** Seconds left on the chat clock at a clip time (the real chat's clock, run fast). */
  clock: (t: number) => number;
  verdict: 'bot' | 'human';
  model?: string;
  card?: RevealCard;
  text: {
    hook: string;
    pause: string;
    /** The reveal's title, e.g. "That was a bot". */
    title: string;
    /** Under the stamp when there is no card (a human). */
    note?: string;
    /** The line under the card, e.g. "Every bot message is signed in a NEAR AI enclave"; none: no line. */
    proof?: string;
    question: string;
    url: string;
    free: string;
  };
  /** The end card's three (the trailer's). */
  trio: { left: string | Look; mid: string | Look; right: string | Look };
  times: ClipTimes;
}

// ---------------------------------------------------------------- shape

interface Geo {
  w: number;
  h: number;
  /** Game buffer under the HUD at S device px per game px. */
  gw: number;
  gh: number;
  orientation: 'landscape' | 'portrait';
  /** Bubble and bubble-text scale (output px per pixel). */
  k: number;
  /** Text scale of the input row. */
  inputK: number;
}

const GEO: Record<Format, Geo> = {
  wide: { w: 1920, h: 1080, gw: 480, gh: Math.ceil((1080 - TOP) / S), orientation: 'landscape', k: 8, inputK: 4 },
  tall: { w: 1080, h: 1920, gw: 270, gh: Math.ceil((1920 - TOP) / S), orientation: 'portrait', k: 7, inputK: 5 },
};

const TITLE = (scale: number): Style => ({ color: P.cream, scale, outline: P.black, extrude: P.tan });
const fmtClock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
/** Space between a bubble and the column's side. */
const INSET = 12;

/** Balanced word wrap (as engine/chat.ts wrapText) measured with the promo font, which has more glyphs. */
export function wrapBalanced(text: string, max: number): string[] {
  const words = text.split(' ');
  const greedy: string[] = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (!cur || textW(cand) <= max) cur = cand;
    else {
      greedy.push(cur);
      cur = w;
    }
  }
  if (cur) greedy.push(cur);
  const n = greedy.length;
  let best = greedy, bestW = Math.max(...greedy.map(textW));
  const split = (i: number, rows: string[]): void => {
    if (rows.length === n - 1) {
      const all = [...rows, words.slice(i).join(' ')];
      const w = Math.max(...all.map(textW));
      if (w < bestW) [best, bestW] = [all, w];
      return;
    }
    for (let j = i + 1; j <= words.length - (n - 1 - rows.length); j++) {
      const row = words.slice(i, j).join(' ');
      if (textW(row) > max) break;
      split(j, [...rows, row]);
    }
  };
  if (n > 1 && n < 6) split(0, []);
  return best;
}

const NBSP = ' ';

/**
 * The reveal's facts in the game's order (web/src/ui/PersonaCard.tsx): age, gender, type, temperament; then job in
 * home. Each fact keeps together and keeps its dot, so a wrapped row never starts with a separator or splits a fact.
 */
export function cardRows(c: RevealCard): { facts: string; where: string } {
  const parts = [c.age !== undefined ? String(c.age) : '', c.gender ?? '', (c.mbti ?? '').toUpperCase(), c.temperament ?? ''].filter(Boolean);
  const facts = parts.map((p, i) => p.replace(/ /g, NBSP) + (i < parts.length - 1 ? NBSP + '·' : '')).join(' ');
  const where = c.job && c.home ? `${c.job} in ${c.home}` : c.job || c.home || '';
  return { facts, where };
}

/** A short line on two rows: the last word alone ("Bot or" / "human?") or the first ("Human" / "or bot?"). */
function twoRows(text: string, alone: 'first' | 'last'): string[] {
  const w = text.split(' ');
  if (w.length < 2) return [text];
  return alone === 'last' ? [w.slice(0, -1).join(' '), w[w.length - 1]] : [w[0], w.slice(1).join(' ')];
}

// ---------------------------------------------------------------- the clip

export class BotOrHumanClip {
  readonly w: number;
  readonly h: number;
  private g: Geo;
  private kit: Kit;
  private label: Color;
  private rig: Rig;
  private chatL: ChatLayout;
  private callL: CallLayout;
  private chatR: SceneRenderer;
  private callR: SceneRenderer;
  private bm: BubbleMetrics;
  private bs: { me: BubbleStyle; them: BubbleStyle };
  private rows: string[][];
  private sizes: { w: number; h: number }[];
  /** The bubble column and the input row (output px). */
  private box: { x: number; y: number; w: number; h: number };
  private input: { x: number; y: number; w: number; h: number };
  private trio: Trio;
  private endSky: Rgba | null = null;

  constructor(private c: ClipConfig, readonly format: Format) {
    const g = (this.g = GEO[format]);
    this.w = g.w;
    this.h = g.h;
    this.kit = getThemeKit(c.theme);
    this.label = hexC(this.kit.colors.labelText);
    this.rig = new Rig(c.partner.seed);
    this.chatL = layoutChat(g.gw, g.gh, { cssPx: S, orientation: g.orientation }) as ChatLayout;
    this.callL = layoutCall(g.gw, g.gh, { cssPx: S, orientation: g.orientation }) as CallLayout;
    this.chatR = new SceneRenderer(c.theme, this.chatL);
    this.callR = new SceneRenderer(c.theme, this.callL);
    this.bm = bubbleMetrics(g.k);
    const st = bubbleStyles(c.theme);
    this.bs = { me: st.me, them: st.them };
    const col = O(this.chatL.chat);
    if (format === 'wide') {
      // the app's column, its input row at the foot of the room
      const ih = 80;
      this.input = { x: col.x, y: col.y + col.h - ih - 8, w: col.w, h: ih };
      this.box = { x: col.x, y: col.y, w: col.w, h: this.input.y - 18 - col.y };
    } else {
      // tall: the column inside the window, its right edge clear of the apps' buttons, the input row high
      // enough that the apps' captions at the bottom never cover it
      const x0 = col.x + 6, x1 = 972;
      this.input = { x: x0, y: 1480, w: x1 - x0, h: 96 };
      this.box = { x: x0, y: col.y, w: x1 - x0, h: this.input.y - 20 - col.y };
    }
    const m = this.bm;
    const maxText = Math.floor((this.box.w - 2 * INSET) * (format === 'wide' ? 0.8 : 0.95) - 2 * m.padX) / m.k;
    this.rows = c.chat.map((msg) => wrapBalanced(msg.text, Math.floor(maxText)));
    const up = (v: number) => Math.ceil(v / m.k) * m.k;
    this.sizes = this.rows.map((rows) => ({
      w: up(Math.max(...rows.map(textW)) * m.k + 2 * m.padX),
      h: up(m.padTop + rows.length * m.lineH + (rows.length - 1) * m.lineGap + m.padBottom),
    }));
    this.trio = new Trio(c.trio);
  }

  /** Bubble rows of each line (for the log and the checks). */
  wrapped(): string[][] {
    return this.rows;
  }

  render(out: Rgba, t: number): void {
    const T = this.c.times;
    if (t < T.hookTo) this.renderHook(out, t);
    else if (t < T.chatTo) this.renderChat(out, t);
    else if (t < T.revealFrom) this.renderPause(out, t);
    else if (t < T.endFrom) this.renderReveal(out, t);
    else this.renderEnd(out, t);
  }

  // ---------------------------------------------------------------- the chat screen

  private drawScene(out: Rgba, scene: Rgba): void {
    blitK(out, scene, 0, TOP, S);
  }

  private hudBar(out: Rgba, t: number): void {
    const left = this.c.clock(t);
    const stats: HudStat[] = [{ label: 'CHAT', value: fmtClock(Math.ceil(left)), icon: icon('flame') }];
    if (this.c.coins > 0) stats.push({ label: 'PLAYING', value: String(this.c.coins), icon: icon('coin') });
    if (this.format === 'wide') {
      hud(out, this.kit, this.c.level, stats, t);
      return;
    }
    // the tall HUD: the logo and the level plate on the left, the pills on the right
    rectOut(out, 0, 0, this.w, HUD_H, P.black);
    rectOut(out, 0, HUD_H - 2, this.w, 2, P.navyDark);
    const lb = createBuffer(LOGO_W, LOGO_H);
    drawLogo(lb, 0, 0, ms(t), 1);
    blitK(out, lb, 10, 4, 2);
    const pw = textW(this.c.level) * 3 + 36;
    nine(out, this.kit.ui.plate, 258, 8, pw, 48, 3);
    drawText(out, this.c.level, 276, 19, { color: P.cyan, scale: 3 });
    let x = this.w - 10;
    for (let i = stats.length - 1; i >= 0; i--) {
      x -= pillW(stats[i]);
      pill(out, this.kit, x, 4, stats[i]);
      x -= 8;
    }
  }

  private renderChat(out: Rgba, t: number, quiet = false): void {
    const c = this.c, kit = this.kit, L = this.chatL, g = this.g;
    // the partner talks a moment as each of its lines lands
    this.rig.lookToward(1);
    this.rig.setTalking(!quiet && c.chat.some((m) => m.from === 'them' && t >= m.at && t < m.at + Math.min(2, 0.5 + m.text.length * 0.04)));
    this.drawScene(out, this.chatR.render({ now: ms(t), partner: this.rig, fuse: c.clock(t) / 120 }));
    this.rig.setTalking(false);
    nameTag(out, L.partner.label, c.partner.name, this.label);
    // the info box (web/src/screens/Chat.tsx): free chat or the play, then the call
    const inf = O(L.info);
    const s = g.orientation === 'landscape' ? 3 : 4;
    const rowH = 11 * s;
    const lines: Run[][] = [
      c.coins > 0 ? [{ text: 'Playing ' }, { text: String(c.coins), color: P.gold }, { text: ' coins' }] : [{ text: 'Free chat' }],
      [{ text: g.orientation === 'landscape' ? 'Two minutes, then you call it:' : 'Then call it:' }],
      [{ text: 'REAL HUMAN?', color: P.gold }],
    ];
    const boxH = g.orientation === 'landscape' ? 2 * 18 + 3 * rowH : inf.h;
    nine(out, kit.ui.panel, inf.x, inf.y, inf.w, boxH, 3);
    const ix = inf.x + 6 * s, tx = ix + 10 * s;
    let y = inf.y + Math.round((boxH - 3 * rowH) / 2) + s;
    blitK(out, icon('coin'), ix, y - 1, s);
    drawRuns(out, lines[0], tx, y, { color: P.greyLight, scale: s });
    y += rowH;
    blitK(out, icon('chat'), ix - s, y, s);
    drawRuns(out, lines[1], tx, y, { color: P.greyLight, scale: s });
    y += rowH;
    drawRuns(out, lines[2], tx, y, { color: P.greyLight, scale: s });
    if (!quiet) this.messages(out, t);
    this.inputRow(out, t, quiet);
    this.hudBar(out, t);
  }

  private inputRow(out: Rgba, t: number, quiet: boolean): void {
    const c = this.c, kit = this.kit, r = this.input, k = this.g.inputK;
    nine(out, kit.ui.panel, r.x, r.y, r.w, r.h, 3);
    const bw = textW('SEND') * k + 16 * k, bh = r.h - 24;
    const fx = r.x + 15, fy = r.y + 15, fw = r.w - 30 - bw - 15, fh = r.h - 30;
    rectOut(out, fx, fy, fw, fh, P.white);
    const ty = fy + Math.round((fh - 7 * k) / 2);
    const typing = quiet ? undefined : c.chat.find((m) => m.from === 'me' && t >= m.typeFrom && t < m.at);
    if (typing) {
      const dur = Math.max(0.2, typing.at - typing.typeFrom - 0.12);
      const n = Math.min(typing.text.length, Math.floor(((t - typing.typeFrom) / dur) * typing.text.length) + 1);
      // the end of a long line: the field scrolls, as an input does
      let shown = typing.text.slice(0, n);
      while (textW(shown) * k > fw - 30 - 4 * k) shown = shown.slice(1);
      drawText(out, shown, fx + 12, ty, { color: P.black, scale: k });
      if (Math.floor(t / 0.25) % 2 === 0 || n < typing.text.length) rectOut(out, fx + 12 + textW(shown) * k + k, ty - k, k, 9 * k, P.black);
    } else drawText(out, 'Type a message...', fx + 12, ty, { color: P.grey, scale: k });
    const sending = !quiet && c.chat.some((m) => m.from === 'me' && t >= m.at - 0.12 && t < m.at + 0.04);
    const bx = r.x + r.w - 15 - bw, by = r.y + 12 + (sending ? 3 : 0);
    nine(out, sending ? kit.ui.buttonPrimary.down : kit.ui.buttonPrimary.up, bx, by, bw, bh, 3);
    drawTextC(out, 'SEND', bx + bw / 2, by + Math.round((bh - 7 * k) / 2) - 2, { color: P.navyDark, scale: k });
  }

  /** The bubbles: newest at the bottom, each pushing the stack up, the oldest scrolling off the top of the column. */
  private messages(out: Rgba, t: number): void {
    const c = this.c, m = this.bm, box = this.box;
    const items: { i: number; h: number; w: number; dots: boolean }[] = [];
    c.chat.forEach((msg, i) => {
      const size = this.sizes[i];
      if (msg.from === 'me' && t >= msg.at) items.push({ i, h: size.h, w: size.w, dots: false });
      if (msg.from === 'them' && t >= msg.typeFrom) {
        const dots = t < msg.at;
        const grow = ease((t - msg.typeFrom) / 0.14);
        const full = dots ? m.dotsH : m.dotsH + (size.h - m.dotsH) * ease((t - msg.at) / 0.1);
        items.push({ i, h: full * grow, w: dots ? m.dotsW : size.w, dots });
      }
    });
    if (!items.length) return;
    const buf = createBuffer(box.w, box.h);
    let y = box.h;
    const ys: number[] = [];
    for (let k = items.length - 1; k >= 0; k--) {
      y -= items[k].h;
      ys[k] = y;
      y -= m.gap * Math.min(1, items[k].h / 20);
    }
    items.forEach((it, k) => {
      const msg = c.chat[it.i];
      const h = Math.round(it.h / m.k) * m.k;
      if (h < m.k * 3) return;
      const by = even(ys[k]);
      if (by + h < -60) return;
      const st = msg.from === 'me' ? this.bs.me : this.bs.them;
      const x = msg.from === 'me' ? box.w - INSET - it.w : INSET;
      if (it.dots) {
        drawDots(buf, st, m, x, by, Math.min(h, m.dotsH), t - msg.typeFrom);
        return;
      }
      const pop = t - msg.at < 0.12 ? -m.k : 0;
      drawBubble(buf, st, m, x, by + pop, it.w, h, [], 0);
      if (h < this.sizes[it.i].h * 0.8) return;
      this.rows[it.i].forEach((row, r) => drawText(buf, row, x + m.padX, by + pop + m.padTop + r * (m.lineH + m.lineGap), { color: st.text, scale: m.k }));
    });
    blitK(out, buf, box.x, box.y, 1);
  }

  // ---------------------------------------------------------------- hook

  /** The question over the partner on its pedestal in the call room: who you are about to judge. */
  private renderHook(out: Rgba, t: number): void {
    this.callScene(out, t);
    dim(out, 1, 0, HUD_H, this.w, this.h - HUD_H);
    this.hudBar(out, t);
    const grow = t < 1 / 24 ? 2 : t < 2 / 24 ? 1 : 0;
    const text = this.c.text.hook;
    if (this.format === 'wide') {
      const s = Math.min(16, Math.floor((this.w - 160) / textW(text))) + grow;
      drawTextC(out, text, this.w / 2, 96 - grow * 4, TITLE(s));
    } else {
      // two lines, as big as the width allows: "Bot or" / "human?"
      const rows = twoRows(text, 'last');
      const s = Math.min(20, Math.floor((this.w - 140) / Math.max(...rows.map(textW)))) + grow;
      rows.forEach((r, i) => drawTextC(out, r, this.w / 2, 150 + i * 10 * s - grow * 4, TITLE(s)));
    }
  }

  // ---------------------------------------------------------------- the pause

  private callScene(out: Rgba, t: number): void {
    const c = this.c, T = c.times;
    this.rig.lookToward(0);
    if (t >= T.stamp) this.rig.react(c.verdict === 'bot' ? 'shrug' : 'nod', ms(T.stamp));
    this.drawScene(out, this.callR.render({ now: ms(t), partner: this.rig }));
    nameTag(out, this.callL.partner.label, c.partner.name, this.label);
  }

  /** The question again and the game's 3-2-1: beside the partner on a wide screen, under it on a tall one. */
  private renderPause(out: Rgba, t: number): void {
    const c = this.c, T = c.times;
    this.callScene(out, t);
    dim(out, 1, 0, HUD_H, this.w, this.h - HUD_H);
    this.hudBar(out, T.chatTo);
    const age = t - T.chatTo;
    const grow = age < 1 / 24 ? 2 : age < 2 / 24 ? 1 : 0;
    const wide = this.format === 'wide';
    // the wall left of the arch on a wide screen, the top on a tall one
    const L = O(this.callL.partner.pedestal);
    const leftMid = even(L.x / 2 + 20), rightMid = even((L.x + L.w + this.w) / 2 - 20);
    if (wide) {
      const rows = twoRows(c.text.pause, 'first');
      const s = Math.min(12, Math.floor((L.x - 120) / Math.max(...rows.map(textW)))) + grow;
      rows.forEach((r, i) => drawTextC(out, r, leftMid, 400 + i * 11 * s - grow * 4, TITLE(s)));
    } else {
      const s = Math.min(13, Math.floor((this.w - 120) / textW(c.text.pause))) + grow;
      drawTextC(out, c.text.pause, this.w / 2, 200 - grow * 4, TITLE(s));
    }
    // 3, 2, 1 in the game's countdown art, one on each beat
    const n = T.count.filter((x) => t >= x).length;
    if (!n) return;
    const since = t - T.count[n - 1];
    const spr = countdownSprite(c.theme, String(4 - n) as '3' | '2' | '1');
    const k = 11 + (since < 1 / 24 ? 3 : since < 2 / 24 ? 1 : 0);
    const cx = wide ? rightMid : this.w / 2, cy = wide ? 560 : 1440;
    blitK(out, spr, even(cx - (spr.w * k) / 2), even(cy - (spr.h * k) / 2), k);
  }

  // ---------------------------------------------------------------- the reveal

  private renderReveal(out: Rgba, t: number): void {
    const c = this.c, T = c.times, kit = this.kit;
    this.callScene(out, t);
    dim(out, 2, 0, HUD_H, this.w, this.h - HUD_H);
    this.hudBar(out, T.chatTo);
    const age = t - T.revealFrom;
    const lift = age < 1 / 24 ? 40 : age < 2 / 24 ? 14 : 0;
    const wide = this.format === 'wide';
    const isBot = c.verdict === 'bot';
    // the panel (web/src/screens/PracticeResult.tsx: the partner, the title, the tag, the card)
    const R = wide ? { x: 150, y: 130, w: 1620, h: 820 } : { x: 40, y: 150, w: 1000, h: 1370 };
    const x = R.x, y = R.y + lift;
    nine(out, kit.ui.panel, x, y, R.w, R.h, 4);
    const portrait = renderPortrait(c.theme, this.rig, ms(t), 64, 76, { selected: true });
    const pk = wide ? 6 : 5;
    const PW = 64 * pk, PH = 76 * pk;
    const stampAge = t - T.stamp;
    const tagScale = (base: number) => base + (stampAge < 1 / 24 ? 5 : stampAge < 2 / 24 ? 2 : 0);
    const tagText = isBot ? 'BOT' : 'HUMAN';
    const tagBg = isBot ? P.blueDark : P.green;
    const tagW = (s: number) => textW(tagText) * s + 4 * s;
    const tagH = (s: number) => 7 * s + 2 * Math.round(1.5 * s);
    if (wide) {
      // portrait and name on the left
      const px = x + 70, py = y + 60;
      rectOut(out, px - 8, py - 8, PW + 16, PH + 16, P.black);
      blitK(out, portrait, px, py, pk);
      drawTextC(out, c.partner.name, px + PW / 2, py + PH + 30, { color: P.white, scale: 6 });
      // the right column: the title, the stamp and the model, the card; the proof across the foot of the panel
      const cx = px + PW + 80;
      const cw = x + R.w - 70 - cx;
      drawText(out, c.text.title, cx, y + 56, TITLE(9));
      const ty = y + 180;
      if (stampAge >= 0) {
        const ts = tagScale(11);
        tag(out, tagText, cx - (ts - 11) * 4, ty - (ts - 11) * 6, { bg: tagBg, fg: P.white, scale: ts });
        if (isBot && c.model) {
          // beside the tag, as large as fits in the panel
          const mx = cx + tagW(11) + 50;
          const ms5 = [5, 4, 3].find((s) => textW(c.model!) * s <= x + R.w - 60 - mx) ?? 2;
          drawText(out, c.model, mx, ty + Math.round(tagH(11) / 2 - (7 * ms5) / 2), { color: P.greyLight, scale: ms5 });
        }
      }
      // a long card steps its text down a size rather than run into the proof line
      const cardY = ty + tagH(11) + 46, proofY = y + R.h - 160;
      const cs = this.cardLayout(cw, 5).h <= proofY - 24 - cardY ? 5 : 4;
      if (t >= T.card) this.card(out, cx, cardY, cw, cs, t - T.card);
      if (t >= T.proof && c.text.proof) this.proof(out, px - 8, proofY, x + R.w - 70 - (px - 8), 5, t - T.proof);
      return;
    }
    // tall: everything stacked down the middle
    const mid = x + R.w / 2;
    drawTextC(out, c.text.title, mid, y + 50, TITLE(Math.min(10, Math.floor((R.w - 80) / textW(c.text.title)))));
    const px = even(mid - PW / 2), py = y + 170;
    rectOut(out, px - 8, py - 8, PW + 16, PH + 16, P.black);
    blitK(out, portrait, px, py, pk);
    drawTextC(out, c.partner.name, mid, py + PH + 30, { color: P.white, scale: 6 });
    const ty = py + PH + 120;
    if (stampAge >= 0) {
      const ts = tagScale(12);
      tag(out, tagText, even(mid - tagW(ts) / 2), ty - (ts - 12) * 6, { bg: tagBg, fg: P.white, scale: ts });
    }
    let yy = ty + tagH(12) + 26;
    if (stampAge >= 0 && isBot && c.model) {
      drawTextC(out, c.model, mid, yy, { color: P.greyLight, scale: Math.max(2, Math.min(4, Math.floor((R.w - 60) / textW(c.model)))) });
    }
    yy += 28 + 34;
    // a long card steps its text down a size so the card and the proof stay inside the panel
    const room = y + R.h - 30 - yy;
    const cs = this.cardLayout(R.w - 100, 5).h + 34 + this.proofH(R.w - 100, 5) <= room ? 5 : 4;
    if (t >= T.card) yy = this.card(out, x + 50, yy, R.w - 100, cs, t - T.card, true);
    else yy += this.cardLayout(R.w - 100, cs).h;
    if (t >= T.proof && c.text.proof) this.proof(out, x + 50, yy + 34, R.w - 100, 5, t - T.proof);
  }

  /** The card's rows at text scale s in a frame w wide, and its height. */
  private cardLayout(w: number, s: number): { rows: { runs: Run[]; color: Color }[]; h: number; pad: number } {
    const c = this.c;
    const pad = 6 * s;
    const inner = Math.floor((w - 2 * pad) / s);
    const rows: { runs: Run[]; color: Color }[] = [];
    if (c.card) {
      const { facts, where } = cardRows(c.card);
      const head: Run[] = [{ text: 'WAS PLAYING', color: P.gold }];
      if (c.card.name) head.push({ text: ' ' + c.card.name, color: P.white });
      rows.push({ runs: head, color: P.gold });
      for (const r of wrap(facts, inner)) rows.push({ runs: [{ text: r }], color: P.white });
      for (const r of wrap(where, inner)) rows.push({ runs: [{ text: r }], color: P.white });
    } else if (c.text.note) {
      for (const r of wrap(c.text.note, inner)) rows.push({ runs: [{ text: r }], color: P.white });
    }
    return { rows, pad, h: rows.length ? 2 * pad + rows.length * 11 * s - 3 * s : 0 };
  }

  /** The proof plate's height at text scale s, w wide. */
  private proofH(w: number, s: number): number {
    if (!this.c.text.proof) return 0;
    const textX = 16 + 5 * s + icon('shield').w * (s + 1) + 3 * s;
    return 2 * 5 * s + wrap(this.c.text.proof, Math.floor((w - 5 * s - textX) / s)).length * 11 * s - 3 * s;
  }

  /** The persona card in a dashed gold frame ("Was playing Hana", the facts, job in home); returns its bottom. */
  private card(out: Rgba, x: number, y: number, w: number, s: number, age: number, centred = false): number {
    const c = this.c;
    const { rows, h, pad } = this.cardLayout(w, s);
    if (!rows.length) return y;
    const lh = 11 * s;
    // the frame draws in, then the rows appear one by one
    const shown = Math.floor(age / 0.12);
    const d = 4;
    for (let i = 0; i < w; i += 24) {
      rectOut(out, x + i, y, Math.min(14, w - i), d, P.gold);
      rectOut(out, x + i, y + h - d, Math.min(14, w - i), d, P.gold);
    }
    for (let i = 0; i < h; i += 24) {
      rectOut(out, x, y + i, d, Math.min(14, h - i), P.gold);
      rectOut(out, x + w - d, y + i, d, Math.min(14, h - i), P.gold);
    }
    rows.forEach((r, i) => {
      if (i > shown) return;
      const ry = y + pad + i * lh;
      if (i === 0 && c.card) {
        const mk = icon('mask');
        const rw = mk.w * s + 3 * s + textW(r.runs.map((u) => u.text).join('')) * s;
        const rx = centred ? even(x + w / 2 - rw / 2) : x + pad;
        blitK(out, mk, rx, ry - Math.round(s / 2), s);
        drawRuns(out, r.runs, rx + mk.w * s + 3 * s, ry, { color: r.color, scale: s });
      } else if (centred) drawTextC(out, r.runs, x + w / 2, ry, { color: r.color, scale: s });
      else drawRuns(out, r.runs, x + pad, ry, { color: r.color, scale: s });
    });
    return y + h;
  }

  /** The proof line on a dark plate with a lime edge and the shield (as the Verify drawer's groups). */
  private proof(out: Rgba, x: number, y: number, w: number, s: number, age: number): void {
    const text = this.c.text.proof!;
    const sh = icon('shield');
    const ik = s + 1;
    const pad = 5 * s;
    const textX = x + 16 + pad + sh.w * ik + 3 * s;
    const rows = wrap(text, Math.floor((x + w - pad - textX) / s));
    const lh = 11 * s;
    const h = 2 * pad + rows.length * lh - 3 * s;
    const lift = age < 1 / 24 ? 10 : 0;
    rectOut(out, x, y + lift, w, h, P.black);
    rectOut(out, x + 4, y + 4 + lift, w - 8, h - 8, P.navyDark);
    rectOut(out, x + 4, y + 4 + lift, 12, h - 8, P.lime);
    blitK(out, sh, x + 16 + pad, y + lift + Math.round(h / 2 - (sh.h * ik) / 2), ik);
    rows.forEach((r, i) => drawText(out, r, textX, y + lift + pad + i * lh, { color: P.white, scale: s }));
  }

  // ---------------------------------------------------------------- the end card

  private renderEnd(out: Rgba, t: number): void {
    const c = this.c, T = c.times;
    const age = t - T.endFrom;
    const wide = this.format === 'wide';
    const K = 6, BW = this.w / K, BH = this.h / K;
    // the trailer's sunrise behind the three (drawn once: the sky does not move here)
    if (!this.endSky) {
      this.endSky = wide
        ? sky({ w: this.w, h: this.h, k: K, sun: { x: BW / 2, y: 143 }, limb: { y: 141, cx: BW / 2 }, clear: [{ x: 0, y: 220, w: this.w, h: 260 }] })
        : sky({ w: this.w, h: this.h, k: K, sun: { x: BW / 2, y: BH - 47 }, limb: { y: BH - 49, cx: BW / 2, curve: 900 }, clear: [{ x: 0, y: 380, w: this.w, h: 640 }] });
    }
    blitK(out, this.endSky, 0, 0, K);
    // the three rise in, a step apart
    const rise = (delay: number) => {
      const fi = Math.floor((age - delay) * 24);
      const steps = [140, 90, 50, 20, 6, -4, 0];
      return fi < 0 ? 400 : fi < steps.length ? steps[fi] : 0;
    };
    const drop = (delay: number) => {
      const fi = Math.floor((age - delay) * 24);
      const steps = [-420, -280, -140, 12, 26, 8, -4, 0];
      return fi < 0 ? -2000 : fi < steps.length ? steps[fi] : 0;
    };
    if (wide) {
      const r = rise(0.05);
      const trioOut = { cx: [600, 960, 1320] as [number, number, number], waist: 968 + r, kMid: 12, kSide: 11 };
      this.trio.draw(out, trioOut);
      crest(out, { k: K, top: 160, cx: BW / 2 });
      const lk = 9, lx = even((this.w - LOGO_W * lk) / 2);
      logo(out, lx, 26 + drop(0), lk, { glint: age < 1.2 ? -12 + (age / 1.2) * (LOGO_W + 30) : null });
      drawTextC(out, c.text.question, this.w / 2, 296, { color: P.white, scale: 9, outline: P.black }, Math.floor(Math.max(0, age - 0.25) * 45));
      if (t >= T.free) this.freeButton(out, this.w / 2, 410, 6, t - T.free);
      if (t >= T.url) {
        const ua = t - T.url;
        const k = ua < 1 / 24 ? 11 : ua < 2 / 24 ? 10 : 9;
        url(out, c.text.url, this.w / 2, 990 - (k - 9) * 4, k);
      }
      return;
    }
    const r = rise(0.05);
    this.trio.draw(out, { cx: [250, 540, 830], waist: 1716 + r, kMid: 14, kSide: 12 });
    crest(out, { k: K, top: Math.round(1716 / K) + 2, cx: BW / 2, curve: 1600, litHalf: 40 });
    const lk = 8, lx = even((this.w - LOGO_W * lk) / 2);
    logo(out, lx, 170 + drop(0), lk, { glint: age < 1.2 ? -12 + (age / 1.2) * (LOGO_W + 30) : null });
    // the question on two lines, as big as fits
    const words = c.text.question.split(' ');
    const half = Math.ceil(words.length / 2);
    const qrows = [words.slice(0, half).join(' '), words.slice(half).join(' ')];
    const qs = Math.min(12, Math.floor((this.w - 120) / Math.max(...qrows.map(textW))));
    let n = Math.floor(Math.max(0, age - 0.25) * 45);
    qrows.forEach((row, i) => {
      drawTextC(out, row, this.w / 2, 470 + i * 11 * qs, { color: P.white, scale: qs, outline: P.black }, n);
      n -= row.length + 1;
    });
    if (t >= T.url) {
      const ua = t - T.url;
      const k = ua < 1 / 24 ? 12 : ua < 2 / 24 ? 11 : 10;
      url(out, c.text.url, this.w / 2, 760 - (k - 10) * 4, k);
    }
    if (t >= T.free) this.freeButton(out, this.w / 2, 920, 7, t - T.free);
  }

  /** "First chat is free" on the game's primary button. */
  private freeButton(out: Rgba, cx: number, y: number, s: number, age: number): void {
    const text = this.c.text.free;
    const w = textW(text) * s + 18 * s, h = 7 * s + 9 * s;
    const pop = age < 1 / 24 ? 8 : age < 2 / 24 ? -4 : 0;
    const x = even(cx - w / 2);
    rectOut(out, x - 6, y - 6 + pop, w + 12, h + 12, P.black);
    nine(out, this.kit.ui.buttonPrimary.up, x, y + pop, w, h, 4);
    drawTextC(out, text, cx, y + pop + Math.round((h - 7 * s) / 2) - s, { color: P.navyDark, scale: s });
  }
}

/** A HUD pill (as src/scenes/promo/ui.ts draws them in the wide HUD). */
function pill(out: Rgba, kit: Kit, x: number, y: number, st: HudStat): void {
  const iw = st.icon ? st.icon.w * 3 + 9 : 0;
  nine(out, kit.ui.panel, x, y, pillW(st), 56, 2);
  if (st.icon) blitK(out, st.icon, x + 15, y + 28 - Math.round((st.icon.h * 3) / 2), 3);
  drawText(out, st.label, x + 15 + iw, y + 10, { color: P.grey, scale: 2 });
  drawText(out, st.value, x + 15 + iw, y + 26, { color: P.white, scale: 3 });
}

void clamp01;
