// The interview's dialogue as a chat: the game's own pixel bubbles (her grey "them" bubbles on her
// side, his cyan ones on his, tails pointing at the speaker), each preceded by bouncing typing
// dots, the text typing in with the speaker's blip voice. Bubbles stack from the bottom of the
// picture and scroll up; the oldest dissolves through the palette as the chat outgrows three.

import { type Rgba, createBuffer, nineSlice, blit } from '../../src/core/buffer.ts';
import { PAL } from '../../src/core/palette.ts';
import { getThemeKit } from '../../src/themes/index.ts';
import { blitK, rectOut, OUT_W, OUT_H, BAR } from './camera.ts';
import { drawString, measure } from './font.ts';
import { CHAT, CHAT_AWAY, THEME, lineShown, typedCount, type Line } from './storyboard.ts';

const kit = getThemeKit(THEME);
const BK = 5; // bubble sprite px
const TS = 5; // text scale (35 px capitals at 1080p)
const MAX_TEXT = 128; // font px per line (640 output px)
const MARGIN = 48;
const BOTTOM = OUT_H - BAR - 28;
const GAP = 34;
const PAD_X = 25, PAD_TOP = 20, PAD_BOTTOM = 15, LINE_H = 9 * TS, LINE_GAP = 8;
const DOTS_W = 120, DOTS_H = 80;
const VISIBLE = 3;

const flip = (src: Rgba) => {
  const b = createBuffer(src.w, src.h);
  blit(b, src, 0, 0, { flipX: true });
  return b;
};
// her bubbles are the partner's grey ones, his the player's cyan; tails turned toward the speaker
const STYLE = {
  guest: { ns: kit.ui.bubbleThem, tail: flip(kit.ui.tailThem), right: true },
  host: { ns: kit.ui.bubbleMe, tail: flip(kit.ui.tailMe), right: false },
};

function wrap(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    const cand = cur ? cur + ' ' + w : w;
    if (!cur || measure(cand) <= MAX_TEXT) cur = cand;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const up = (v: number) => Math.ceil(v / BK) * BK;

interface Item {
  line: Line;
  rows: string[];
  w: number;
  h: number;
  from: number; // typing dots start
}
const ITEMS: Item[] = CHAT.map((line) => {
  const rows = wrap(lineShown(line));
  const w = up(Math.max(...rows.map(measure)) * TS + PAD_X * 2);
  const h = up(PAD_TOP + rows.length * LINE_H + (rows.length - 1) * LINE_GAP + PAD_BOTTOM);
  return { line, rows, w, h, from: line.at - (line.lead ?? 0.7) };
});

const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

function bubble(out: Rgba, it: Item, x: number, y: number, w: number, h: number, dark: number, draw: (b: Rgba) => void): void {
  const st = STYLE[it.line.speaker as 'host' | 'guest'];
  // compose at bubble-pixel scale for the frame and tail, then the text on top at output scale
  const bw = Math.round(w / BK), bh = Math.round(h / BK);
  const b = createBuffer(bw, bh + 5);
  nineSlice(b, st.ns.img, st.ns.slice, 0, 0, bw, bh);
  blit(b, st.tail, st.right ? bw - 9 : 2, bh - 1);
  blitK(out, b, x, y, BK, { dark });
  draw(out);
}

/** Draw the chat at time t over the interview picture (call before the letterbox bars). */
export function drawChat(out: Rgba, t: number): void {
  const away = ease((t - CHAT_AWAY) / 0.32);
  if (away >= 1) return;
  const live = ITEMS.filter((it) => t >= it.from);
  if (!live.length) return;
  // layout from the newest at the bottom up; a new item grows in and pushes the stack up
  const hs = live.map((it) => {
    const grow = ease((t - it.from) / 0.14);
    const full = t < it.line.at ? DOTS_H : DOTS_H + (it.h - DOTS_H) * ease((t - it.line.at) / 0.1);
    return full * grow;
  });
  let y = BOTTOM;
  const ys: number[] = [];
  for (let i = live.length - 1; i >= 0; i--) {
    y -= hs[i];
    ys[i] = y;
    y -= GAP * Math.min(1, hs[i] / 20);
  }
  const drop = Math.round((away * away * 700) / 2) * 2;
  live.forEach((it, i) => {
    const age = live.length - 1 - i; // 0 = newest
    let dark = 0;
    if (age >= VISIBLE) {
      // the oldest dissolves as the newest arrives, then is gone
      const since = t - live[live.length - 1].from;
      if (since > 0.3) return;
      dark = 1 + Math.floor((since / 0.3) * 4);
      if (dark >= 4) return;
    }
    const st = STYLE[it.line.speaker as 'host' | 'guest'];
    const typing = t < it.line.at;
    const w = typing ? DOTS_W : it.w;
    const h = Math.round(hs[i] / BK) * BK;
    if (h < BK * 3) return;
    const x = st.right ? OUT_W - MARGIN - w : MARGIN;
    const by = Math.round(ys[i] / 2) * 2 + drop;
    if (typing) {
      bubble(out, it, x, by, w, Math.min(h, DOTS_H), dark, (o) => {
        // three dots, one hopping at a time
        const hop = Math.floor((t - it.from) / 0.14) % 3;
        for (let d = 0; d < 3; d++) {
          const dx = x + 30 + d * 22, dy = by + 36 - (d === hop ? 6 : 0);
          rectOut(o, dx, dy, 12, 12, d === hop ? PAL.navy : PAL.slate);
        }
      });
      return;
    }
    bubble(out, it, x, by, w, h, dark, (o) => {
      if (dark) return;
      // type the text in across its wrapped rows
      let n = typedCount(it.line, t);
      it.rows.forEach((row, r) => {
        if (n <= 0) return;
        const shown = Math.min(n, row.length);
        drawString(o, row, x + PAD_X, by + PAD_TOP + r * (LINE_H + LINE_GAP), { color: PAL.black, scale: TS }, shown);
        n -= row.length + 1; // the space the row broke on
      });
    });
  });
}
