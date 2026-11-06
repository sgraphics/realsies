// The X thread's stills, drawn like everything else here: the trailer's pixel font, the game's
// icons and UI kit, the end card's sky, trio and logo, all in the ENDESGA-32 palette.
//   mechanics:  the round's loop (play coins, chat two minutes, call, reveal) and the split of the
//               coins of wrong paid calls, as stacks of the game's coin
//   builders:   the chain of proof from a builder's prompt to the Verify panel, and who joins
//   summary:    the end card's art (logo, trio, sunrise, realsies.lol) with six short bullets, 16:9 or square
// Every fact on them comes from the repo's README and docs/agents.md.

import { type Rgba, type Color, type Look, PAL, icon, getThemeKit, type ThemeId } from '../../art.ts';
import { blitK, rectOut, fillOut } from '../../engine/camera.ts';
import { drawText, drawTextC, drawRuns, textW, wrap, type Run, type Style } from './text.ts';
import { nine, even } from './ui.ts';
import { sky, crest, logo, url, Trio, LOGO_W, LOGO_H } from './hero.ts';

const P = PAL;
const TITLE = (scale: number): Style => ({ color: P.cream, scale, outline: P.black, extrude: P.tan });
type IconName = Parameters<typeof icon>[0];

/** The diagrams' backdrop: the end card's night, calmer (no sun, no rays, no stars), the planet's lit limb low at the bottom. */
function backdrop(out: Rgba): void {
  fillOut(out, P.black);
  const k = 6;
  blitK(out, sky({ w: out.w, h: out.h, k, stars: 0, tones: [P.black, P.black, P.navyDark], limb: { y: Math.ceil(out.h / k) - 6, cx: out.w / k / 2, curve: 2200 } }), 0, 0, k);
}

/** The gold step chip of the video's captions. */
function chip(out: Rgba, n: string, x: number, y: number, s: number): void {
  rectOut(out, x - 5, y - 5, s + 10, s + 10, P.black);
  rectOut(out, x, y, s, s, P.gold);
  rectOut(out, x, y, s, 5, P.yellow);
  rectOut(out, x, y + s - 7, s, 7, P.orange);
  const k = Math.floor(s / 10);
  drawText(out, n, even(x + s / 2 - (textW(n) * k) / 2), Math.round(y + s / 2 - (7 * k) / 2), { color: P.black, scale: k });
}

/** A right-pointing pixel arrow, `len` long, centred on y. */
function arrowRight(out: Rgba, x: number, y: number, len: number, c: Color, t = 8): void {
  rectOut(out, x, y - t / 2, len - 3 * t, t, c);
  for (let i = 0; i < 4; i++) rectOut(out, x + len - 4 * t + i * t, y - (4 - i) * t + t / 2 - t / 2, t, (4 - i) * 2 * t - t, c);
}

/** A down-pointing connector between two nodes. */
function arrowDown(out: Rgba, x: number, y0: number, y1: number, c: Color, t = 6): void {
  rectOut(out, x - t / 2, y0, t, y1 - y0 - 2 * t, c);
  for (let i = 0; i < 3; i++) rectOut(out, x - (3 - i) * t + t / 2, y1 - 3 * t + i * t, (3 - i) * 2 * t - t, t, c);
}

/** A dark box with a coloured rim. */
function frame(out: Rgba, x: number, y: number, w: number, h: number, rim: Color, fill: Color = P.black, t = 6): void {
  rectOut(out, x - 4, y - 4, w + 8, h + 8, P.black);
  rectOut(out, x, y, w, h, rim);
  rectOut(out, x + t, y + t, w - 2 * t, h - 2 * t, fill);
}

function kit(theme: ThemeId = 'space') {
  return getThemeKit(theme);
}

// ---------------------------------------------------------------- mechanics

export function mechanics(out: Rgba): void {
  backdrop(out);
  const K = kit();
  logo(out, 56, 30, 4, { sparkles: false });
  drawTextC(out, 'How a round works', 1060, 46, TITLE(9));
  // the loop: four cards, arrows between
  const cards: { icons: IconName[]; title: string; sub: string }[] = [
    { icons: ['coin'], title: 'Play coins', sub: 'before the chat' },
    { icons: ['chat'], title: 'Chat 2 min', sub: 'with a stranger' },
    { icons: ['user', 'bot'], title: 'Call it', sub: 'human or bot?' },
    { icons: ['shield'], title: 'Reveal', sub: 'proven on NEAR' },
  ];
  const cw = 392, ch = 236, gap = 64, y0 = 168;
  const x0 = even((out.w - (4 * cw + 3 * gap)) / 2);
  cards.forEach((c, i) => {
    const x = x0 + i * (cw + gap);
    nine(out, K.ui.panel, x, y0, cw, ch, 4);
    chip(out, String(i + 1), x + 22, y0 + 22, 52);
    const k = 8;
    const iw = c.icons.reduce((a, n) => a + icon(n).w * k, 0) + (c.icons.length - 1) * 16;
    let ix = even(x + cw / 2 - iw / 2);
    for (const n of c.icons) {
      const ic = icon(n);
      blitK(out, ic, ix, y0 + 30 + Math.round(((10 - ic.h) * k) / 2), k);
      ix += ic.w * k + 16;
    }
    drawTextC(out, c.title, x + cw / 2, y0 + 124, { color: P.white, scale: 6 });
    drawTextC(out, c.sub, x + cw / 2, y0 + 186, { color: P.greyLight, scale: 4 });
    if (i < 3) arrowRight(out, x + cw + 10, y0 + ch / 2, gap - 20, P.gold, 6);
  });
  // the bot fund comes off every play first
  const lx = 72;
  let y = 448;
  blitK(out, icon('bot'), lx, y - 4, 5);
  drawRuns(out, [{ text: 'Every play: ' }, { text: '5%', color: P.gold }, { text: ' goes to the bot fund first, for inference' }], lx + 9 * 5 + 22, y, { color: P.greyLight, scale: 5 });
  // the split: stacks of the game's coin, ten in all
  y = 518;
  drawText(out, 'Then the coins of wrong paid calls split three ways:', lx, y, { color: P.white, scale: 6 });
  const rows: { pct: string; n: number; color: Color; title: string; sub: string[] }[] = [
    { pct: '70%', n: 7, color: P.lime, title: 'Right paid callers', sub: ['pro rata, by the coins they played'] },
    { pct: '20%', n: 2, color: P.gold, title: 'Turing bonus to the character', sub: ['the human called a bot, or the', 'builder whose bot was called human'] },
    { pct: '10%', n: 1, color: P.greyLight, title: 'The game', sub: [] },
  ];
  let ry = 598;
  const pctR = lx + 200, coinsX = lx + 228, labelX = lx + 228 + 7 * 50 + 50;
  for (const r of rows) {
    drawText(out, r.pct, pctR - textW(r.pct) * 9, ry - 8, { color: r.color, scale: 9, outline: P.black });
    for (let i = 0; i < r.n; i++) blitK(out, icon('coin'), coinsX + i * 50, ry - 4, 6);
    drawText(out, r.title, labelX, ry, { color: P.white, scale: 6 });
    r.sub.forEach((l, i) => drawText(out, l, labelX, ry + 54 + i * 36, { color: P.greyLight, scale: 4 }));
    ry += 54 + r.sub.length * 36 + (r.sub.length ? 22 : 0);
  }
  // the two edge cases
  const fy = 924, fh = 76;
  const t1: Run[] = [{ text: 'Nobody right: ', color: P.gold }, { text: 'the character gets 90%' }];
  const t2: Run[] = [{ text: 'Nobody wrong: ', color: P.gold }, { text: 'nothing moves' }];
  const w1 = textW(t1.map((r) => r.text).join('')) * 5 + 56, w2 = textW(t2.map((r) => r.text).join('')) * 5 + 56;
  const fx = even((out.w - (w1 + 40 + w2)) / 2);
  frame(out, fx, fy, w1, fh, P.slate, P.navyDark, 4);
  drawRuns(out, t1, fx + 28, fy + 21, { color: P.white, scale: 5 });
  frame(out, fx + w1 + 40, fy, w2, fh, P.slate, P.navyDark, 4);
  drawRuns(out, t2, fx + w1 + 40 + 28, fy + 21, { color: P.white, scale: 5 });
}

// ---------------------------------------------------------------- AI builders and TEEs

export function builders(out: Rgba): void {
  backdrop(out);
  logo(out, 56, 30, 4, { sparkles: false });
  drawTextC(out, 'For AI builders', 1060, 46, TITLE(9));
  const DIV = 1132;
  // the halves
  drawText(out, 'The chain of proof', 60, 168, TITLE(8));
  drawText(out, 'Who joins', DIV + 60, 168, TITLE(8));
  for (let y = 160; y < 1040; y += 28) rectOut(out, DIV, y, 6, 14, P.slate);
  // left: the chain, top to bottom
  const nodes: { icon: IconName; rim: Color; title: Run[]; sub: string[] }[] = [
    { icon: 'mask', rim: P.magenta, title: [{ text: 'An AI builder\'s persona' }], sub: ['its system prompt, committed by sha256'] },
    { icon: 'lock', rim: P.cyan, title: [{ text: 'NEAR AI enclave', color: P.cyan }, { text: ' signs every reply' }], sub: ['Intel TDX + NVIDIA confidential GPUs'] },
    { icon: 'check', rim: P.lime, title: [{ text: 'The relay checks each signature' }], sub: ['before a word reaches the player'] },
    { icon: 'chat', rim: P.greyLight, title: [{ text: 'The player sees the words' }], sub: ['two minutes, then the call'] },
    { icon: 'link', rim: P.gold, title: [{ text: 'NEAR', color: P.gold }, { text: ': committed, then recovered' }], sub: ['round start: model, prompt hash, signer', 'round end: the contract runs ecrecover'] },
    { icon: 'shield', rim: P.blue, title: [{ text: 'Anyone rechecks it in Verify' }], sub: ['every signature, in the browser'] },
  ];
  let y = 262;
  const BOX = 80, TX = 60 + BOX + 30;
  nodes.forEach((n, i) => {
    frame(out, 60, y, BOX, BOX, n.rim, P.black, 5);
    const ic = icon(n.icon);
    const k = 6;
    blitK(out, ic, even(60 + BOX / 2 - (ic.w * k) / 2), even(y + BOX / 2 - (ic.h * k) / 2), k);
    drawRuns(out, n.title, TX, y + 2, { color: P.white, scale: 5 });
    n.sub.forEach((l, j) => drawText(out, l, TX, y + 50 + j * 34, { color: P.greyLight, scale: 4 }));
    const h = Math.max(BOX, 50 + n.sub.length * 34);
    const next = y + h + 44;
    if (i < nodes.length - 1) arrowDown(out, 60 + BOX / 2, y + BOX + 8, next - 6, P.slate, 6);
    y = next;
  });
  // right: who enters agents, what they earn and get, the rule
  const RX = DIV + 60;
  y = 268;
  blitK(out, icon('bot'), RX, y, 6);
  blitK(out, icon('bot'), RX + 9 * 6 + 14, y, 6);
  blitK(out, icon('bot'), RX + 2 * (9 * 6 + 14), y, 6);
  y += 9 * 6 + 26;
  for (const l of ['LLM operators, chat and', 'voice agent vendors', 'enter their agents']) {
    drawText(out, l, RX, y, { color: P.white, scale: 5 });
    y += 46;
  }
  y += 26;
  const label = (text: string, c: Color) => {
    drawText(out, text, RX, y, { color: c, scale: 4 });
    y += 42;
  };
  label('THEY EARN', P.gold);
  blitK(out, icon('coin'), RX, y - 2, 5);
  for (const l of ['The Turing bonus,', 'paid on chain']) {
    drawText(out, l, RX + 7 * 5 + 20, y, { color: P.white, scale: 5 });
    y += 46;
  }
  y += 22;
  label('THEY GET', P.cyan);
  blitK(out, icon('chat'), RX, y - 2, 4);
  drawText(out, 'Every transcript', RX + 10 * 4 + 20, y, { color: P.white, scale: 5 });
  y += 50;
  blitK(out, icon('star'), RX - 2, y - 4, 4);
  for (const l of ['A scorecard: how often', 'real people believed', 'their agent']) {
    drawText(out, l, RX + 10 * 4 + 20, y, { color: P.white, scale: 5 });
    y += 46;
  }
  // the rule, in a frame
  y += 26;
  const bw = out.w - 56 - RX;
  frame(out, RX, y, bw, 128, P.gold, P.navyDark, 6);
  blitK(out, icon('lock'), RX + 26, y + 34, 6);
  drawText(out, 'Brains choose timing,', RX + 26 + 9 * 6 + 22, y + 24, { color: P.white, scale: 5 });
  drawText(out, 'never words.', RX + 26 + 9 * 6 + 22, y + 72, { color: P.gold, scale: 5 });
}

// ---------------------------------------------------------------- summary

export interface SummaryOpts {
  trio: { left: string | Look; mid: string | Look; right: string | Look };
  url: string;
  bullets: { icon: IconName; text: string }[];
}

/** The end card's art (sunrise, the smug three, the logo, the URL) with the bullets beside it: 1920x1080. */
export function summary(out: Rgba, o: SummaryOpts): void {
  const K = 6;
  // the sun behind the three, on the right
  const sunX = 1450 / K;
  const bulletsBox = { x: 60, y: 250, w: 1000, h: 640 };
  blitK(out, sky({ w: out.w, h: out.h, k: K, sun: { x: sunX, y: 143 }, limb: { y: 141, cx: sunX, curve: 7000 }, clear: [bulletsBox, { x: 0, y: 0, w: 1100, h: 250 }] }), 0, 0, K);
  new Trio(o.trio).draw(out, { cx: [1166, 1450, 1734], waist: 960, kMid: 12, kSide: 11 });
  crest(out, { k: K, top: 160, cx: sunX, curve: 9000, litHalf: 50 });
  logo(out, 72, 52, 7);
  bullets(out, o.bullets, 92, 316, 6, 96);
  url(out, o.url, 1450, 992, 9);
}

/** The same, square: logo on top, the bullets, the three and the URL under them. 1080x1080. */
export function summarySquare(out: Rgba, o: SummaryOpts): void {
  const K = 6;
  const sunX = out.w / 2 / K;
  const scale = 5;
  const widest = Math.max(...o.bullets.map((b) => textW(b.text))) * scale + 9 * 5 + 26;
  const bx = even((out.w - widest) / 2);
  blitK(out, sky({ w: out.w, h: out.h, k: K, sun: { x: sunX, y: 143 }, limb: { y: 141, cx: sunX }, clear: [{ x: 0, y: 0, w: out.w, h: 700 }] }), 0, 0, K);
  new Trio(o.trio).draw(out, { cx: [326, 540, 754], waist: 960, kMid: 8, kSide: 7 });
  crest(out, { k: K, top: 160, cx: sunX, litHalf: 40 });
  const lk = 8;
  logo(out, even((out.w - LOGO_W * lk) / 2), 44, lk);
  bullets(out, o.bullets, bx, 44 + LOGO_H * lk + 54, scale, 70);
  url(out, o.url, out.w / 2, 992, 8);
}

function bullets(out: Rgba, list: { icon: IconName; text: string }[], x: number, y: number, scale: number, pitch: number): void {
  const k = scale - 1;
  for (const b of list) {
    const ic = icon(b.icon);
    blitK(out, ic, x + Math.round(((10 - ic.w) * k) / 2), y + Math.round((7 * scale - ic.h * k) / 2), k);
    drawText(out, b.text, x + 10 * k + 26, y, { color: P.white, scale, outline: P.black });
    y += pitch;
  }
}

export { LOGO_W, LOGO_H };
