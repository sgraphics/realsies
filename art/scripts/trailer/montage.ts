// The game montage at the game's own 1080p scale (4 device px per game px, as chooseScale picks
// for a 1920x1080 window under the HUD): the lobby, the VS countdown, the chat and the call, from
// the engine's SceneRenderer, UI kit, countdown art and icons. The DOM layer of the real app (HUD,
// gamertags, bubbles, buttons) is redrawn here in the trailer's pixel font.

import { type Rgba, createBuffer, nineSlice, blit, px, get } from '../../src/core/buffer.ts';
import { type Color, PAL, TRANSPARENT, lighter } from '../../src/core/palette.ts';
import { Rig } from '../../src/rig/rig.ts';
import { rngFrom, randomSeed } from '../../src/core/rng.ts';
import { layoutLobby, layoutChat, layoutCall } from '../../src/scene/layout.ts';
import { SceneRenderer } from '../../src/scene/renderer.ts';
import type { CallLayout, ChatLayout, LobbyLayout, Rect, SceneSeat } from '../../src/scene/types.ts';
import { getThemeKit } from '../../src/themes/index.ts';
import { drawLogo, LOGO_W, LOGO_H } from '../../src/themes/logo.ts';
import { countdownSprite, countdownStyle, renderVsDoor } from '../../src/ui/countdown.ts';
import { icon } from '../../src/ui/icons.ts';
import { blitK, rectOut, fillOut, OUT_W, OUT_H } from './camera.ts';
import { drawString, drawCentered, measure, type TextStyle } from './font.ts';
import { castLook, CAST } from './actor.ts';
import { THEME, CUE, beat, BEAT, CHAT_LINES, TAGS, GUEST_SEAT, GUEST_TAG, type Shot } from './storyboard.ts';

const S = 4; // device px per game px
const HUD_H = 64; // CSS px of the HUD bar at 1080p
const TOP = HUD_H - 14 * S; // canvas top: its 14-px frame bar hides under the HUD
const GW = 480, GH = Math.ceil((OUT_H - HUD_H) / S) + 14; // 268

const P = PAL;
const kit = getThemeKit(THEME);
const hexC = (h: string) => parseInt(h.slice(1), 16) as Color;
const ms = (t: number) => t * 1000;

// ---------------------------------------------------------------- cast of the game screens

const seedRng = rngFrom('trailer-lobby');
const lobbyRigs: Rig[] = TAGS.map((_, i) => (i === GUEST_SEAT ? new Rig(castLook(CAST.guest)) : new Rig(randomSeed(seedRng))));
const guestRig = new Rig(castLook(CAST.guest));
const meRig = new Rig('me-120'); // dark bob, headphones, orange sweater
meRig.lookToward(1);
guestRig.lookToward(-1);

// ---------------------------------------------------------------- layouts and renderers

const lobbyL = layoutLobby(GW, GH, 10, { cssPx: S }) as LobbyLayout;
const chatL = layoutChat(GW, GH, { cssPx: S, orientation: 'landscape' }) as ChatLayout;
const callL = layoutCall(GW, GH, { cssPx: S, orientation: 'landscape' }) as CallLayout;
const lobbyR = new SceneRenderer(THEME, lobbyL);
const chatR = new SceneRenderer(THEME, chatL);
const callR = new SceneRenderer(THEME, callL);

/** Game rect -> output rect. */
const O = (r: Rect) => ({ x: r.x * S, y: r.y * S + TOP, w: r.w * S, h: r.h * S });

function drawScene(out: Rgba, scene: Rgba): void {
  blitK(out, scene, 0, TOP, S);
}

function nine(out: Rgba, ns: { img: Rgba; slice: number }, x: number, y: number, w: number, h: number, k: number): void {
  const bw = Math.max(ns.slice * 2 + 1, Math.round(w / k)), bh = Math.max(ns.slice * 2 + 1, Math.round(h / k));
  const b = createBuffer(bw, bh);
  nineSlice(b, ns.img, ns.slice, 0, 0, bw, bh);
  blitK(out, b, x, y, k);
}

const textOn = (color: Color, scale: number, outline?: Color): TextStyle => ({ color, scale, outline });

// ---------------------------------------------------------------- HUD

function pill(out: Rgba, x: number, y: number, label: string, value: string, ic?: Rgba): number {
  const vw = measure(value) * 3, lw = measure(label) * 2;
  const iw = ic ? ic.w * 3 + 9 : 0;
  const w = Math.max(vw, lw) + iw + 30;
  nine(out, kit.ui.panel, x, y, w, 56, 2);
  if (ic) blitK(out, ic, x + 15, y + 28 - Math.round((ic.h * 3) / 2), 3);
  drawString(out, label, x + 15 + iw, y + 10, textOn(P.grey, 2));
  drawString(out, value, x + 15 + iw, y + 26, textOn(P.white, 3));
  return w;
}

function hud(out: Rgba, kind: 'lobby' | 'chat' | 'call', t: number): void {
  rectOut(out, 0, 0, OUT_W, HUD_H, P.black);
  rectOut(out, 0, HUD_H - 2, OUT_W, 2, P.navyDark);
  const lb = createBuffer(LOGO_W, LOGO_H);
  drawLogo(lb, 0, 0, ms(t), 1);
  blitK(out, lb, 10, 4, 2);
  // level plate
  const plate = 'STAR STATION';
  const pw = measure(plate) * 3 + 36;
  nine(out, kit.ui.plate, 258, 8, pw, 48, 3);
  drawString(out, plate, 276, 19, textOn(P.cyan, 3));
  // stats, right-aligned
  const stats: [string, string, Rgba | undefined][] =
    kind === 'lobby' ? [['ROUND', '8:52', icon('clock')], ['COINS', '120', icon('coin')], ['RATING', '1032', icon('star')], ['CALLED', '0/10', icon('check')]]
    : kind === 'chat' ? [['CHAT', fmt(113 - (t - beat(7))), icon('flame')], ['MODE', 'FREE', icon('coin')], ['ROUND', '8:44', icon('clock')]]
    : [['ROUND', '8:43', icon('clock')], ['COINS', '120', icon('coin')], ['RATING', '1032', icon('star')]];
  let x = OUT_W - 10;
  const widths = stats.map(([l, v, ic]) => Math.max(measure(v) * 3, measure(l) * 2) + (ic ? ic.w * 3 + 9 : 0) + 30);
  for (let i = stats.length - 1; i >= 0; i--) {
    x -= widths[i];
    pill(out, x, 4, stats[i][0], stats[i][1], stats[i][2]);
    x -= 8;
  }
}

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

function nameTag(out: Rgba, r: Rect, name: string, color: Color = hexC(kit.colors.labelText)): void {
  const o = O(r);
  const tw = measure(name) * 3;
  const w = tw + 18, h = 33;
  const x = Math.round((o.x + o.w / 2 - w / 2) / 2) * 2, y = o.y;
  rectOut(out, x, y, w, h, P.black);
  rectOut(out, x, y, w, 3, P.navyDark);
  drawString(out, name, x + 9, y + 6, textOn(color, 3));
}

// ---------------------------------------------------------------- lobby

export function renderLobby(out: Rgba, t: number): void {
  const sel = t >= beat(CUE.lobbySelect);
  const seats: SceneSeat[] = lobbyRigs.map((rig, i) => ({ rig, look: i === GUEST_SEAT && sel ? 'selected' : 'idle' }));
  drawScene(out, lobbyR.render({ now: ms(t), seats }));
  lobbyL.seats.forEach((s, i) => nameTag(out, s.label, TAGS[i], i === GUEST_SEAT && sel ? P.yellow : undefined));
  hud(out, 'lobby', t);
}

// ---------------------------------------------------------------- countdown

const DOOR_U = 10;
const DW = OUT_W / DOOR_U, DH = OUT_H / DOOR_U;
const doorCache = new Map<string, Rgba>();
function door(side: 'me' | 'them', flash: boolean): Rgba {
  const key = side + flash;
  let d = doorCache.get(key);
  if (!d) {
    const cx = DW / 2, cy = 47, slant = 0.2;
    d = renderVsDoor(THEME, side, DW, DH, { cx, cy, seamTop: cx + cy * slant, seamBottom: cx - (DH - cy) * slant, rays: 14 });
    if (flash)
      for (let y = 0; y < d.h; y++)
        for (let x = 0; x < d.w; x++) {
          const c = get(d, x, y);
          if (c !== TRANSPARENT) px(d, x, y, lighter(c, 1));
        }
    doorCache.set(key, d);
  }
  return d;
}

export function renderCountdown(out: Rgba, t: number): void {
  const b = (t - beat(0)) / BEAT; // beats since the downbeat
  const open = Math.max(0, Math.min(1, (b - CUE.doorsOpen) / 0.5));
  if (open > 0) renderChat(out, t, true);
  else fillOut(out, P.black);
  const stage = b >= CUE.countGo ? 'go' : b >= CUE.count1 ? '1' : b >= CUE.count2 ? '2' : '3';
  const since = b - (stage === 'go' ? CUE.countGo : stage === '1' ? CUE.count1 : stage === '2' ? CUE.count2 : CUE.count3);
  const flash = since * BEAT < 2 / 24;
  const slide = Math.round((open * open * 1100) / 10) * 10;
  blitK(out, door('me', flash), -slide, 0, DOOR_U);
  blitK(out, door('them', flash), slide, 0, DOOR_U);
  if (open >= 1) return;
  const st = countdownStyle(THEME);
  // fighters on their doors, name plates under them
  const k = 10;
  const fy = 1080 - 40 - 96 - 48 * k + 28;
  blitK(out, meRig.frame(ms(t), { shadow: true }), 48 - slide, fy, k);
  blitK(out, guestRig.frame(ms(t), { shadow: true }), OUT_W - 48 - 32 * k + slide, fy, k);
  plate(out, 40 - slide, 1080 - 40 - 96, 'YOU', 'Ana', st.me[0]);
  plate(out, OUT_W - 40 - 380 + slide, 1080 - 40 - 96, 'REAL HUMAN?', GUEST_TAG, st.them[0]);
  const vs = countdownSprite(THEME, 'vs');
  blitK(out, vs, Math.round((960 - (vs.w * 4) / 2) / 2) * 2, 1080 - 36 - vs.h * 4, 4);
  // banner
  if (stage !== 'go') {
    const line = 'CHAT STARTS IN ';
    const w = (measure(line) + measure(stage)) * 5 + 60;
    const x = Math.round((960 - w / 2) / 2) * 2;
    nine(out, kit.ui.plate, x, 32, w, 78, 3);
    drawString(out, line, x + 30, 48, textOn(P.white, 5));
    drawString(out, stage, x + 30 + measure(line) * 5, 48, textOn(P.gold, 5));
  }
  // the numeral (or CHAT!) with a one-beat pop
  const spr = countdownSprite(THEME, stage === 'go' ? 'go' : (stage as `${number}`));
  const kk = stage === 'go' ? 11 : 12;
  const pop = since * BEAT < 3 / 24 ? 2 : 0;
  const kn = kk + pop;
  const sx = Math.round((960 - (spr.w * kn) / 2) / 2) * 2 - slide * (stage === 'go' ? 0 : 1);
  const sy = Math.round((480 - (spr.h * kn) / 2) / 2) * 2;
  blitK(out, spr, sx, sy, kn);
}

function plate(out: Rgba, x: number, y: number, top: string, name: string, rim: Color): void {
  const w = 380, h = 96;
  rectOut(out, x, y, w, h, P.black);
  rectOut(out, x + 4, y + 4, w - 8, h - 8, P.navyDark);
  rectOut(out, x, y, w, 4, rim);
  drawCentered(out, top, x + w / 2, y + 16, textOn(P.gold, 4));
  drawCentered(out, name, x + w / 2, y + 52, textOn(P.white, 4));
}

// ---------------------------------------------------------------- chat

const BK = 3; // bubble sprite px
function bubble(out: Rgba, text: string, right: boolean, y: number, area: { x: number; w: number }, count = Infinity): number {
  const ns = right ? kit.ui.bubbleMe : kit.ui.bubbleThem;
  const tail = right ? kit.ui.tailMe : kit.ui.tailThem;
  const tw = measure(text) * 3;
  const w = Math.ceil((tw + 30) / BK) * BK, h = 17 * BK;
  const x = right ? area.x + area.w - w - 6 : area.x + 6;
  nine(out, ns, x, y, w, h, BK);
  blitK(out, tail, right ? x + w - 9 * BK : x + 2 * BK, y + h - BK, BK);
  drawString(out, text, x + 15, y + 14, textOn(hexC(right ? kit.colors.bubbleMeText : kit.colors.bubbleThemText), 3), count);
  return h;
}

export function renderChat(out: Rgba, t: number, under = false): void {
  const b = (t - beat(0)) / BEAT;
  const fuse = 0.66 - Math.max(0, b - 7) * 0.012;
  drawScene(out, chatR.render({ now: ms(t), partner: guestRig, fuse }));
  nameTag(out, chatL.partner.label, GUEST_TAG);
  const c = O(chatL.chat);
  const area = { x: c.x, w: c.w };
  let y = c.y + 12;
  if (!under && b >= CUE.bubbleMe) {
    const pop = b - CUE.bubbleMe < 0.12 ? 6 : 0;
    y += bubble(out, CHAT_LINES.me, true, y + pop, area) + 24;
    if (b >= CUE.typingFrom && b < CUE.bubbleThem) {
      // typing dots in her bubble
      const n = 1 + (Math.floor((t * 1000) / 160) % 3);
      bubble(out, '.'.repeat(n).padEnd(3, ' '), false, y, area);
    } else if (b >= CUE.bubbleThem) {
      const pop2 = b - CUE.bubbleThem < 0.12 ? 6 : 0;
      bubble(out, CHAT_LINES.them, false, y + pop2, area);
    }
  }
  // the input row at the bottom of the chat column
  const iy = c.y + c.h - 66;
  nine(out, kit.ui.panel, c.x, iy, c.w, 66, 3);
  rectOut(out, c.x + 15, iy + 15, c.w - 180, 36, P.white);
  drawString(out, 'Type a message...', c.x + 27, iy + 21, textOn(P.grey, 3));
  nine(out, kit.ui.buttonPrimary.up, c.x + c.w - 150, iy + 12, 135, 42, 3);
  drawCentered(out, 'SEND', c.x + c.w - 82, iy + 20, textOn(P.navyDark, 3));
  // info box under the partner
  const inf = O(chatL.info);
  nine(out, kit.ui.panel, inf.x, inf.y, inf.w, 129, 3);
  blitK(out, icon('coin'), inf.x + 18, inf.y + 15, 3);
  drawString(out, 'Free chat', inf.x + 48, inf.y + 18, textOn(P.greyLight, 3));
  blitK(out, icon('chat'), inf.x + 15, inf.y + 54, 3);
  drawString(out, 'Two minutes, then you call it:', inf.x + 48, inf.y + 54, textOn(P.greyLight, 3));
  drawString(out, 'REAL HUMAN?', inf.x + 48, inf.y + 90, textOn(P.gold, 3));
  if (!under) hud(out, 'chat', t);
}

// ---------------------------------------------------------------- call

/** A pixel arrow cursor (white with a black outline), game px. */
const CURSOR = (() => {
  const rows = [
    'K..........',
    'KK.........',
    'KWK........',
    'KWWK.......',
    'KWWWK......',
    'KWWWWK.....',
    'KWWWWWK....',
    'KWWWWWWK...',
    'KWWWWWWWK..',
    'KWWWWWKKKK.',
    'KWWKWWK....',
    'KWK.KWWK...',
    'KK..KWWK...',
    'K....KWWK..',
    '.....KWWK..',
    '......KK...',
  ];
  const b = createBuffer(11, rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch !== '.' && px(b, x, y, ch === 'K' ? P.black : P.white)));
  return b;
})();

const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export function renderCall(out: Rgba, t: number): void {
  const b = (t - beat(0)) / BEAT;
  drawScene(out, callR.render({ now: ms(t), partner: guestRig }));
  nameTag(out, callL.partner.label, GUEST_TAG);
  // question panel
  const q = O(callL.question);
  q.h = 132;
  nine(out, kit.ui.panel, 960 - 320, q.y, 640, q.h, 4);
  drawCentered(out, 'Real human?', 960, q.y + 20, { color: P.cream, scale: 6, outline: P.black, extrude: P.tan });
  const left = Math.max(0, 13 - Math.floor(b - 12));
  const clk = icon('clock');
  const line = `0:${String(left).padStart(2, '0')} to make your call`;
  const lw = measure(line) * 3 + clk.w * 3 + 12;
  const lx = Math.round((960 - lw / 2) / 2) * 2;
  blitK(out, clk, lx, q.y + q.h - 46, 3);
  drawString(out, line, lx + clk.w * 3 + 12, q.y + q.h - 45, textOn(P.greyLight, 3));
  // the cursor: in from below, onto YES, over to NO, back toward YES, never clicking. It lands on
  // each button exactly on its cue (the tick in the soundtrack); the highlight follows the cursor.
  const yes = O(callL.yes), no = O(callL.no);
  yes.y -= 12; no.y -= 12;
  const pts: [number, number, number][] = [
    [CUE.cursorIn, 980, 1130],
    [CUE.hoverYes, yes.x + yes.w * 0.55, yes.y + yes.h * 0.55],
    [CUE.hoverNo, no.x + no.w * 0.45, no.y + no.h * 0.5],
    [CUE.hoverYes2, yes.x + yes.w * 0.62, yes.y + yes.h * 0.45],
  ];
  let cx = pts[0][1], cy = pts[0][2];
  for (let i = 1; i < pts.length; i++) {
    const [b0, x0, y0] = pts[i - 1], [b1, x1, y1] = pts[i];
    const leave = Math.max(b0, b1 - 0.55);
    if (b >= leave) {
      const u = ease((b - leave) / (b1 - leave));
      cx = x0 + (x1 - x0) * u;
      cy = y0 + (y1 - y0) * u;
    }
  }
  // a nervous little hover
  if (b > CUE.hoverYes) {
    cx += Math.sin(t * 23) * 6;
    cy += Math.cos(t * 17) * 4;
  }
  // the DOM buttons are taller than their layout rect at this size: an 88-px button centred on it
  const drawn = (r: Rect) => {
    const o0 = O(r);
    return { x: o0.x, y: Math.round(o0.y + o0.h / 2 - 44), w: o0.w, h: 88 };
  };
  const inside = (o: { x: number; y: number; w: number; h: number }) => cx >= o.x && cx < o.x + o.w && cy >= o.y && cy < o.y + o.h;
  const hover = inside(drawn(callL.yes)) ? 'yes' : inside(drawn(callL.no)) ? 'no' : '';
  const btn = (r: Rect, which: 'yes' | 'no') => {
    const o = drawn(r);
    const set = which === 'yes' ? kit.ui.buttonYes : kit.ui.buttonNo;
    const on = hover === which;
    if (on) {
      rectOut(out, o.x - 8, o.y - 4, o.w + 16, o.h + 8, P.cyan);
      rectOut(out, o.x - 4, o.y - 8, o.w + 8, o.h + 16, P.cyan);
    }
    nine(out, set.up, o.x, o.y, o.w, o.h, 4);
    const ic = icon(which === 'yes' ? 'user' : 'bot');
    const label = which === 'yes' ? 'YES' : 'NO';
    const w = ic.w * 4 + 20 + measure(label) * 6;
    const x = Math.round((o.x + o.w / 2 - w / 2) / 2) * 2;
    blitK(out, ic, x, o.y + 40 - (ic.h * 4) / 2, 4);
    drawString(out, label, x + ic.w * 4 + 20, o.y + 18, { color: P.white, scale: 6, outline: P.black });
  };
  btn(callL.yes, 'yes');
  btn(callL.no, 'no');
  blitK(out, CURSOR, Math.round(cx / 4) * 4, Math.round(cy / 4) * 4, 4);
  hud(out, 'call', t);
}

export function renderMontage(out: Rgba, shot: Shot, t: number): void {
  if (shot.kind === 'lobby') renderLobby(out, t);
  else if (shot.kind === 'countdown') renderCountdown(out, t);
  else if (shot.kind === 'chat') renderChat(out, t);
  else renderCall(out, t);
}

void blit;
