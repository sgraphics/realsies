// How you win: the scoring as scenes. YOU on the left, your chat partner on the right (a "???" until
// the reveal), the room's calls on that partner as a bar above them. Each scenario: you play coins
// and make your call (a chat bubble, your coins joining that side of the bar), the partner is
// revealed (a bot's eyes light up cyan), RIGHT or WRONG lands, and the coins fly: from the wrong
// side to you, or from you to the right callers, to the partner (the Turing bonus) and the game.
// The amounts are computed from the game's rules (shared with the contract): 5% of a play to the
// bot fund, then the wrong calls' coins split 70% to the right callers pro rata, 20% to the
// character, 10% to the game.

import { type Rgba, type Color, type Look, PAL, icon } from '../../art.ts';
import { blitK, rectOut, fillOut, OUT_W, OUT_H } from '../../engine/camera.ts';
import { bubbleStyles, bubbleMetrics, bubbleSize, drawBubble } from '../../engine/chat.ts';
import { JackActor, type EyeState } from '../jackin.ts';
import { drawText, drawTextC, drawRuns, textW, type Run, type Style } from './text.ts';
import { tag, ease, clamp01, even } from './ui.ts';
import { sky, crest, logo, url, LOGO_W } from './hero.ts';

const P = PAL;
type Side = 'human' | 'bot';

export const RULES = { fee: 0.05, right: 0.7, character: 0.2, game: 0.1 };

export interface Scenario {
  /** What the partner really is, and what you call. */
  truth: Side;
  call: Side;
  /** Coins the rest of the room put on each call about this partner (after the fee). */
  others: Record<Side, number>;
  /** Coins you play. */
  play: number;
  /** One or two lines under the scene once the result is in. */
  caption: Run[][];
}

/** Your net result in coins (fee included), from the rules. */
export function outcome(s: Scenario): { right: boolean; net: number; onCall: number; reward: number } {
  const onCall = s.play * (1 - RULES.fee);
  const right = s.call === s.truth;
  if (!right) return { right, net: -s.play, onCall, reward: 0 };
  const other: Side = s.call === 'human' ? 'bot' : 'human';
  const reward = (RULES.right * s.others[other] * onCall) / (s.others[s.call] + onCall);
  return { right, net: onCall + reward - s.play, onCall, reward };
}

/** A net amount as shown: whole coins from 10 up, one decimal below; `like` formats a running count the way its final amount is. */
export const fmtNet = (n: number, like = n) => (n >= 0 ? '+' : '−') + (Math.abs(like) >= 9.95 ? Math.round(Math.abs(n)).toString() : Math.abs(n).toFixed(1));

/** Times inside a scenario, in seconds from its start. */
export const BEATS = { bar: 0.05, call: 0.55, join: 0.8, joined: 1.25, reveal: 1.65, verdict: 2.15, fly: 2.45, flyDur: 0.75, count: 2.55, countDur: 0.7, caption: 2.6 };

export interface ScoringConfig {
  you: Look;
  partners: Record<Side, { look: Look; bigEyes?: boolean }>;
  /** The header over every scenario. */
  title: string;
}

// layout, output px
const YOU_X = 500, PARTNER_X = 1420, WAIST = 846, K = 12;
const BAR = { x: 300, y: 214, w: 1320, h: 64 };
const MID_X = 960;
const FOOT = 852;
const TAG_Y = 404;

const TITLE = (scale: number): Style => ({ color: P.cream, scale, outline: P.black, extrude: P.tan });

export class ScoringScene {
  private you: JackActor;
  private partner: Record<Side, JackActor>;
  private bg: Rgba;
  constructor(private cfg: ScoringConfig) {
    this.you = new JackActor(cfg.you, false, 1, false);
    this.partner = {
      human: new JackActor(cfg.partners.human.look, !!cfg.partners.human.bigEyes, 1, false),
      bot: new JackActor(cfg.partners.bot.look, !!cfg.partners.bot.bigEyes, 1, false),
    };
    const k = 6;
    this.bg = sky({ w: OUT_W, h: OUT_H, k, stars: 0.006, tones: [P.black, P.black, P.navyDark], limb: { y: Math.ceil(OUT_H / k) - 26, cx: OUT_W / k / 2, curve: 2600 } });
  }

  private backdrop(out: Rgba): void {
    fillOut(out, P.black);
    blitK(out, this.bg, 0, 0, 6);
  }

  private header(out: Rgba, n: number | null, total: number): void {
    logo(out, 40, 28, 3, { sparkles: false });
    drawTextC(out, this.cfg.title, MID_X, 44, TITLE(7));
    if (n !== null) {
      const s = `${n}/${total}`;
      const w = textW(s) * 6 + 36;
      rectOut(out, OUT_W - 60 - w - 4, 36, w + 8, 64, P.black);
      rectOut(out, OUT_W - 60 - w, 40, w, 56, P.gold);
      rectOut(out, OUT_W - 60 - w, 40, w, 6, P.yellow);
      drawText(out, s, OUT_W - 60 - w + 18, 47, { color: P.black, scale: 6 });
    }
  }

  /** A character standing, waist up, centred on cx; the crest in front cuts the legs. */
  private stand(out: Rgba, a: JackActor, cx: number, eyes: EyeState, bob = 0): void {
    blitK(out, a.frame({ eyes, jolt: 0, lit: false }), cx - 16 * K, WAIST - 34 * K + bob, K);
  }

  /** The room's calls on the partner: HUMAN on the left, BOT on the right, your coins joining your side. */
  private roomBar(out: Rgba, s: Scenario, u: number, joined: number): void {
    const grow = ease(clamp01((u - BEATS.bar) / 0.35));
    if (grow <= 0) return;
    drawTextC(out, "The room's calls on your partner", MID_X, BAR.y - 62, { color: P.greyLight, scale: 5 });
    const mine = s.play * joined;
    const h = s.others.human + (s.call === 'human' ? mine : 0);
    const b = s.others.bot + (s.call === 'bot' ? mine : 0);
    const minW = 150;
    let wh = Math.round((BAR.w * h) / (h + b));
    wh = Math.max(minW, Math.min(BAR.w - minW, wh));
    const W = Math.round(BAR.w * grow);
    const x0 = even(MID_X - W / 2);
    const whG = Math.round(wh * grow);
    rectOut(out, x0 - 6, BAR.y - 6, W + 12, BAR.h + 12, P.black);
    rectOut(out, x0, BAR.y, whG, BAR.h, P.green);
    rectOut(out, x0, BAR.y, whG, 8, P.lime);
    rectOut(out, x0 + whG, BAR.y, W - whG, BAR.h, P.blueDark);
    rectOut(out, x0 + whG, BAR.y, W - whG, 8, P.blue);
    rectOut(out, x0 + whG - 3, BAR.y, 6, BAR.h, P.black);
    // your coins, a gold block at the outer end of your side
    if (joined > 0 && grow >= 1) {
      const yw = Math.round(40 * joined);
      const yx = s.call === 'human' ? x0 + 6 : x0 + W - 6 - yw;
      rectOut(out, yx, BAR.y + 12, yw, BAR.h - 24, P.gold);
      rectOut(out, yx, BAR.y + 12, yw, 6, P.yellow);
    }
    if (grow < 1) return;
    // icons in the segments, the counts under them
    blitK(out, icon('user'), x0 + (s.call === 'human' && joined > 0 ? 60 : 18), BAR.y + 12, 4);
    blitK(out, icon('bot'), x0 + W - (s.call === 'bot' && joined > 0 ? 60 : 18) - 9 * 4, BAR.y + 12, 4);
    const lab = (side: Side, n: number) => [{ text: side === 'human' ? 'HUMAN ' : 'BOT ', color: side === 'human' ? P.lime : P.cyan }, { text: `${Math.round(n)} coins` }];
    drawRuns(out, lab('human', h), x0, BAR.y + BAR.h + 18, { color: P.white, scale: 5 });
    const rb = lab('bot', b);
    drawRuns(out, rb, x0 + W - textW(rb.map((r) => r.text).join('')) * 5, BAR.y + BAR.h + 18, { color: P.white, scale: 5 });
  }

  /** Your call: a chat bubble in the game's style by your head. */
  private callBubble(out: Rgba, s: Scenario, u: number): void {
    if (u < BEATS.call) return;
    const text = s.call === 'human' ? 'Human!' : 'Bot!';
    const st = bubbleStyles('space').meOnLeft;
    const m = bubbleMetrics(8);
    const sz = bubbleSize([text], m);
    const pop = u - BEATS.call < 0.08 ? 8 : 0;
    drawBubble(out, st, m, YOU_X + 150, 540 - sz.h - pop, sz.w, sz.h, [text], 99);
  }

  private nameTags(out: Rgba, s: Scenario | null, u: number): void {
    const tw = textW('YOU') * 6 + 24;
    tag(out, 'YOU', YOU_X - tw / 2, TAG_Y, { bg: P.gold, fg: P.black, scale: 6, padX: 12 });
    if (s) {
      // the coins you play, beside your tag: a coin and the amount
      const amt = String(s.play);
      const c = icon('coin');
      const x1 = YOU_X - tw / 2 - 24;
      const x0 = x1 - textW(amt) * 6 - 12 - c.w * 5;
      blitK(out, c, even(x0), TAG_Y + 8, 5);
      drawText(out, amt, even(x0 + c.w * 5 + 12), TAG_Y + 12, { color: P.gold, scale: 6, outline: P.black });
    }
    const revealed = s !== null && u >= BEATS.reveal;
    if (!revealed) {
      tag(out, '???', PARTNER_X - (textW('???') * 6 + 24) / 2, TAG_Y, { bg: P.slate, fg: P.white, scale: 6, padX: 12 });
      return;
    }
    const isBot = s!.truth === 'bot';
    const text = isBot ? 'BOT' : 'HUMAN';
    const ic = icon(isBot ? 'bot' : 'user');
    const w = textW(text) * 6 + 24 + ic.w * 5 + 6;
    const pop = u - BEATS.reveal < 0.1 ? -10 : 0;
    tag(out, text, PARTNER_X - w / 2, TAG_Y + pop, { bg: isBot ? P.cyan : P.lime, fg: P.black, scale: 6, padX: 12, icon: ic });
  }

  private verdict(out: Rgba, s: Scenario, u: number): void {
    if (u < BEATS.verdict) return;
    const o = outcome(s);
    const a = u - BEATS.verdict;
    const k = a < 0.05 ? 16 : a < 0.1 ? 13 : 12;
    const word = o.right ? 'RIGHT!' : 'WRONG';
    drawTextC(out, word, MID_X, 584 - (k - 12) * 3, { color: o.right ? P.lime : P.red, scale: k, outline: P.black, extrude: o.right ? P.green : P.redDark });
    // the amount counts up (or down) to the result
    if (u < BEATS.count) return;
    const c = ease(clamp01((u - BEATS.count) / BEATS.countDur));
    const net = o.net * c;
    const big = o.right && o.net >= 10;
    const ks = big ? 20 : 15;
    // the amount and "coins" on one line, centred together, "coins" sitting on the amount's baseline
    const amt = fmtNet(net, o.net);
    const aw = textW(fmtNet(o.net)) * ks, cw = textW('coins') * 6, gap = 24;
    const x = even(MID_X - (aw + gap + cw) / 2);
    const y = 690;
    drawText(out, amt, x, y, { color: o.right ? P.gold : P.greyLight, scale: ks, outline: P.black, extrude: o.right ? P.orange : P.slate });
    drawText(out, 'coins', x + aw + gap, y + 7 * ks - 7 * 6, { color: P.white, scale: 6, outline: P.black });
  }

  /** Coins in flight: from the wrong side to you, or from you to the right side, the partner and the game. */
  private flights(out: Rgba, s: Scenario, u: number): void {
    const a = u - BEATS.fly;
    if (a < 0 || a > BEATS.flyDur + 0.5) return;
    const o = outcome(s);
    const barMid = (side: Side) => ({ x: side === 'human' ? BAR.x + 160 : BAR.x + BAR.w - 160, y: BAR.y + BAR.h / 2 });
    const you = { x: YOU_X, y: 690 };
    const routes: { from: { x: number; y: number }; to: { x: number; y: number }; n: number }[] = [];
    if (o.right) {
      const wrong: Side = s.call === 'human' ? 'bot' : 'human';
      routes.push({ from: barMid(wrong), to: you, n: Math.max(3, Math.min(16, Math.round(o.net / 4) + 3)) });
    } else {
      routes.push({ from: you, to: barMid(s.truth), n: 7 }); // 70% to the right callers
      routes.push({ from: you, to: { x: PARTNER_X, y: 690 }, n: 2 }); // 20%: the Turing bonus
      routes.push({ from: you, to: { x: 150, y: 60 }, n: 1 }); // 10%: the game
    }
    const coin = icon('coin');
    for (const r of routes)
      for (let i = 0; i < r.n; i++) {
        const t = clamp01((a - i * 0.04) / BEATS.flyDur);
        if (t <= 0 || t >= 1) continue;
        const e = ease(t);
        const x = r.from.x + (r.to.x - r.from.x) * e + Math.sin(i * 1.7) * 30 * Math.sin(Math.PI * t);
        const y = r.from.y + (r.to.y - r.from.y) * e - 140 * Math.sin(Math.PI * t);
        blitK(out, coin, even(x - coin.w * 3), even(y - coin.h * 3), 6);
      }
  }

  /** Where your lost coins went: three short lines under the amount. */
  private split(out: Rgba, s: Scenario, u: number): void {
    const o = outcome(s);
    if (o.right || u < BEATS.fly + BEATS.flyDur) return;
    const who = s.truth === 'bot' ? "the bot's builder" : 'the human';
    const lines: Run[][] = [
      [{ text: '70% ', color: P.lime }, { text: 'to the right callers' }],
      [{ text: '20% ', color: P.gold }, { text: `to ${who}` }],
      [{ text: '10% ', color: P.greyLight }, { text: 'to the game' }],
    ];
    // one column, left aligned, centred as a block
    const wmax = Math.max(...lines.map((l) => textW(l.map((r) => r.text).join('')))) * 4;
    const x = even(MID_X - wmax / 2);
    lines.forEach((l, i) => drawRuns(out, l, x, 806 + i * 38, { color: P.white, scale: 4, outline: P.black }));
  }

  private caption(out: Rgba, s: Scenario, u: number): void {
    if (u < BEATS.caption) return;
    s.caption.forEach((l, i) => drawTextC(out, l, MID_X, FOOT + 84 + i * 52, { color: P.white, scale: 5, outline: P.black }));
  }

  /** The intro: the two of them, the hook over them. */
  intro(out: Rgba, u: number, lines: Run[][]): void {
    this.backdrop(out);
    this.header(out, null, 0);
    this.stand(out, this.you, YOU_X, 'open');
    this.stand(out, this.partner.human, PARTNER_X, 'open');
    crest(out, { k: 6, top: FOOT / 6, cx: OUT_W / 12, curve: 6000, litHalf: 400 });
    this.nameTags(out, null, u);
    lines.forEach((l, i) => {
      const a = u - 0.15 - i * 0.45;
      if (a < 0) return;
      drawTextC(out, l, MID_X, 190 + i * 130, { color: P.white, scale: i === 0 ? 10 : 6, outline: P.black, extrude: i === 0 ? P.slate : undefined });
    });
  }

  scenario(out: Rgba, s: Scenario, n: number, total: number, u: number): void {
    this.backdrop(out);
    this.header(out, n, total);
    const joined = clamp01((u - BEATS.join) / (BEATS.joined - BEATS.join));
    this.roomBar(out, s, u, joined);
    const revealed = u >= BEATS.reveal;
    // the partner looks like anyone until the reveal; a bot's eyes then light up (with a flicker)
    const r = u - BEATS.reveal;
    const botEyes: EyeState = r < 0 ? 'open' : r < 0.08 ? 'glow' : r < 0.16 ? 'open' : 'glow';
    const partner = this.partner[s.truth];
    const o = outcome(s);
    const hop = o.right && u >= BEATS.verdict && u < BEATS.verdict + 0.25 ? -Math.round(Math.sin(((u - BEATS.verdict) / 0.25) * Math.PI) * 24) : 0;
    this.stand(out, this.you, YOU_X, u >= BEATS.call && u < BEATS.call + 0.12 ? 'half' : 'open', hop);
    this.stand(out, partner, PARTNER_X, s.truth === 'bot' && revealed ? botEyes : 'open');
    crest(out, { k: 6, top: FOOT / 6, cx: OUT_W / 12, curve: 6000, litHalf: 400 });
    this.nameTags(out, s, u);
    this.callBubble(out, s, u);
    // your coins hop from you to your side of the bar
    if (u >= BEATS.join && u < BEATS.joined) {
      const t = ease((u - BEATS.join) / (BEATS.joined - BEATS.join));
      const to = { x: s.call === 'human' ? BAR.x + 40 : BAR.x + BAR.w - 40, y: BAR.y + BAR.h / 2 };
      const x = YOU_X + (to.x - YOU_X) * t, y = 640 + (to.y - 640) * t - 120 * Math.sin(Math.PI * t);
      const c = icon('coin');
      blitK(out, c, even(x - c.w * 4), even(y - c.h * 4), 8);
    }
    this.verdict(out, s, u);
    this.split(out, s, u);
    this.flights(out, s, u);
    this.caption(out, s, u);
  }

  /** The outro: the rule in one line, the hook, the logo and the address. */
  outro(out: Rgba, u: number, lines: Run[][], foot: string): void {
    this.backdrop(out);
    const lk = 10;
    logo(out, even(MID_X - (LOGO_W * lk) / 2), 70, lk, { glint: u < 0.6 ? Math.round(-12 + (u / 0.6) * 90) : 44 });
    lines.forEach((l, i) => {
      if (u < 0.3 + i * 0.5) return;
      drawTextC(out, l, MID_X, 470 + i * 110, { color: P.white, scale: i === 0 ? 6 : 8, outline: P.black, extrude: i === 0 ? undefined : P.slate });
    });
    if (u >= 1.4) url(out, 'realsies.lol', MID_X, 800, 10);
    drawTextC(out, foot, MID_X, 990, { color: P.slate, scale: 4 });
  }
}
