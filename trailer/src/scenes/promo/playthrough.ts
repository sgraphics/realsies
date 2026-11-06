// One round of the game, played through at the game's own 1080p scale (4 device px per game px):
// the lobby and a tap, the seat dialog and a play of coins, the 3-2-1 countdown, a two-minute chat
// squeezed into a few seconds, the call, the round's results and the Verify drawer. The rooms,
// characters, pedestals, fuse, countdown art and icons come from the engine; the app's DOM layer
// (HUD, dialog, bubbles, buttons, results, checks) is redrawn in the trailer's pixel font after
// web/src/screens, a little larger than the app so it reads in a video. A variant supplies who
// sits where, what is said, the numbers and every time.

import { type Rgba, type Color, type Look, type SceneSeat, type ThemeId, type LobbyLayout, type ChatLayout, type CallLayout, createBuffer, get, px, PAL, TRANSPARENT, lighter, Rig, layoutLobby, layoutChat, layoutCall, SceneRenderer, getThemeKit, countdownSprite, countdownStyle, renderVsDoor, icon } from '../../art.ts';
import { renderPortrait } from '../../promo-art.ts';
import { blitK, rectOut, fillOut, OUT_W, OUT_H } from '../../engine/camera.ts';
import { bubbleMetrics, bubbleStyles, bubbleSize, wrapText, drawBubble, drawDots, type BubbleMetrics } from '../../engine/chat.ts';
import { drawText, drawTextC, drawRuns, textW, wrap, type Run } from './text.ts';
import { P, S, O, GW, GH, TOP, nine, dim, hud, nameTag, cursor, tag, checkBox, highlight, ease, even, clamp01, hexC, ms, type HudStat, type Kit } from './ui.ts';

// ---------------------------------------------------------------- config

export interface ChatMsg {
  from: 'me' | 'them';
  text: string;
  /** me: typing into the input starts; them: the typing dots start. */
  typeFrom: number;
  /** The bubble lands. */
  at: number;
}

export interface PersonaCard {
  name: string;
  /** Facts in reading order, e.g. ['34', 'woman', 'ISFJ', 'warm introvert', 'night-shift nurse in Porto, Portugal']. */
  facts: string[];
  style: string;
  emoji: string;
}

export interface PlaythroughTimes {
  /** Lobby: the cursor comes in, hovers the character, clicks; the seat dialog opens. */
  cursorIn: number;
  hover: number;
  click: number;
  dialog: number;
  /** Seat dialog: the cursor heads for the coin preset, is on it, clicks; the dialog closes. */
  toCoins: number;
  onCoins: number;
  clickCoins: number;
  close: number;
  /** Countdown beats and the doors opening. */
  count3: number;
  count2: number;
  count1: number;
  go: number;
  doors: number;
  /** Chat clock: 2:00 at chatFrom, 0:00 at chatTo (time runs fast). */
  chatFrom: number;
  chatTo: number;
  /** Call: the screen, the cursor in, on YES, on NO, the click; the round clock spins to 0:00. */
  callFrom: number;
  callCursorIn: number;
  hoverYes: number;
  hoverNo: number;
  clickNo: number;
  spinFrom: number;
  spinTo: number;
  /** Results: the panel, the truth stamp, the verdict, the coins counting up, the cursor to Verify, the click. */
  resultsFrom: number;
  stamp: number;
  right: number;
  coinsFrom: number;
  coinsTo: number;
  toVerify: number;
  clickVerify: number;
  /** Status before the countdown: the coins being placed, then matched. */
  placing: number;
  matched: number;
  /** Verify drawer: in, each check passing, the verdict. */
  verifyFrom: number;
  checks: number[];
  verdict: number;
}

export interface PlaythroughConfig {
  theme: ThemeId;
  level: string;
  /** The lobby: gamertags and rig seeds by seat; one seat may carry a look instead of a seed. */
  tags: string[];
  seeds: string[];
  lookSeat?: { seat: number; look: () => Look };
  /** The seat the player taps. */
  pick: number;
  me: { seed: string; name: string };
  /** Coin presets of the level, the play, the wallet. */
  presets: [number, number, number];
  usdPerCoin: number;
  balance: number;
  play: number;
  rating: number;
  /** Round clock at the first frame, in seconds, and the round number of the results. */
  roundLeft: number;
  roundNo: number;
  callSeconds: number;
  chat: ChatMsg[];
  /** Bubble scale (output px per bubble and font pixel) and wrap width in font px. */
  bubbles: { k: number; wrap: number };
  /** The reveal. */
  truth: 'bot' | 'human';
  model: string;
  botmaster: string;
  persona: PersonaCard;
  result: { coinsDelta: number; ratingDelta: number; paidCalls: number; saidHuman: number; links: [string, string][] };
  /** The Verify drawer: the checks it lists (by group) and the verdict count. */
  verify: {
    /** The intro lines at the top of the drawer. */
    intro: string[];
    groups: { title: string; checks: { label: string; detail?: string }[]; note?: string; links?: [string, string][] }[];
    total: number;
  };
  times: PlaythroughTimes;
}

export type Screen = 'lobby' | 'seat' | 'status' | 'countdown' | 'chat' | 'call' | 'results' | 'verify';

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const DOOR_U = 10;
const DW = OUT_W / DOOR_U, DH = OUT_H / DOOR_U;

/** Where the chat column ends: above the caption band (the app's column runs to the frame). */
const CHAT_BOTTOM = 900;

function plate(out: Rgba, x: number, y: number, top: string, name: string, rim: Color): void {
  const w = 380, h = 96;
  rectOut(out, x, y, w, h, P.black);
  rectOut(out, x + 4, y + 4, w - 8, h - 8, P.navyDark);
  rectOut(out, x, y, w, 4, rim);
  drawTextC(out, top, x + w / 2, y + 16, { color: P.gold, scale: 4 });
  drawTextC(out, name, x + w / 2, y + 52, { color: P.white, scale: 4 });
}

/** Points the variant's callouts and highlights aim at (output px). */
export interface Anchors {
  coins: { x: number; y: number; w: number; h: number };
  saidHuman: { x: number; y: number };
  coinsDelta: { x: number; y: number };
  botTag: { x: number; y: number };
  verifyGroups: { x: number; y: number; w: number; h: number }[];
  drawer: { x: number; w: number };
}

export class Playthrough {
  private kit: Kit;
  private lobbyRigs: Rig[];
  private pickRig: Rig;
  private meRig: Rig;
  private lobbyL: LobbyLayout;
  private chatL: ChatLayout;
  private callL: CallLayout;
  private lobbyR: SceneRenderer;
  private chatR: SceneRenderer;
  private callR: SceneRenderer;
  private doorCache = new Map<string, Rgba>();
  private bm: BubbleMetrics;
  private bs: ReturnType<typeof bubbleStyles>;
  private rows: string[][];
  private label: Color;
  /** Filled in as screens are drawn. */
  readonly anchors: Anchors = { coins: { x: 0, y: 0, w: 0, h: 0 }, saidHuman: { x: 0, y: 0 }, coinsDelta: { x: 0, y: 0 }, botTag: { x: 0, y: 0 }, verifyGroups: [], drawer: { x: 0, w: 0 } };

  constructor(private c: PlaythroughConfig) {
    this.kit = getThemeKit(c.theme);
    this.label = hexC(this.kit.colors.labelText);
    this.bm = bubbleMetrics(c.bubbles.k);
    this.bs = bubbleStyles(c.theme);
    this.rows = c.chat.map((m) => wrapText(m.text, c.bubbles.wrap));
    const rigOf = (i: number) => (c.lookSeat && c.lookSeat.seat === i ? new Rig(c.lookSeat.look()) : new Rig(c.seeds[i]));
    this.lobbyRigs = c.seeds.map((_, i) => rigOf(i));
    this.pickRig = rigOf(c.pick);
    this.meRig = new Rig(c.me.seed);
    this.meRig.lookToward(1);
    this.lobbyL = layoutLobby(GW, GH, c.seeds.length, { cssPx: S }) as LobbyLayout;
    this.chatL = layoutChat(GW, GH, { cssPx: S, orientation: 'landscape' }) as ChatLayout;
    this.callL = layoutCall(GW, GH, { cssPx: S, orientation: 'landscape' }) as CallLayout;
    this.lobbyR = new SceneRenderer(c.theme, this.lobbyL);
    this.chatR = new SceneRenderer(c.theme, this.chatL);
    this.callR = new SceneRenderer(c.theme, this.callL);
    // lay out the results and the drawer once, so the anchors are known before any frame
    const scratch = createBuffer(OUT_W, OUT_H);
    this.resultsPanel(scratch, c.times.coinsTo + 1, true);
    this.drawerPanel(scratch, c.times.verdict + 1, 0);
  }

  private get pickTag(): string {
    return this.c.tags[this.c.pick];
  }

  private drawScene(out: Rgba, scene: Rgba): void {
    blitK(out, scene, 0, TOP, S);
  }

  /** The round clock (seconds left) at video time t: real time, two minutes during the chat, a spin to 0:00, then the next round. */
  roundLeft(t: number): number {
    const T = this.c.times, R0 = this.c.roundLeft;
    if (t < T.chatFrom) return R0 - t;
    const atChat = R0 - T.chatFrom;
    if (t < T.chatTo) return atChat - (120 * (t - T.chatFrom)) / (T.chatTo - T.chatFrom);
    const afterChat = atChat - 120;
    if (t < T.spinFrom) return afterChat - (t - T.chatTo);
    const atSpin = afterChat - (T.spinFrom - T.chatTo);
    if (t < T.spinTo) return atSpin * (1 - ease((t - T.spinFrom) / (T.spinTo - T.spinFrom)));
    return 600 - (t - T.spinTo);
  }

  // ---------------------------------------------------------------- lobby

  private cursorPath(t: number, pts: [number, number, number][]): { x: number; y: number } {
    let x = pts[0][1], y = pts[0][2];
    for (let i = 1; i < pts.length; i++) {
      const [t0, x0, y0] = pts[i - 1], [t1, x1, y1] = pts[i];
      if (t >= t0) {
        const u = ease((t - t0) / (t1 - t0));
        x = x0 + (x1 - x0) * u;
        y = y0 + (y1 - y0) * u;
      }
    }
    return { x, y };
  }

  private pickPoint(): { x: number; y: number } {
    const s = this.lobbyL.seats[this.c.pick];
    return { x: s.char.x * S + 16 * S + 8, y: s.char.y * S + TOP + 30 * S };
  }

  renderLobby(out: Rgba, t: number, o: { cursor?: boolean; after?: boolean } = {}): void {
    const c = this.c, T = c.times;
    const after = !!o.after;
    const hover = !after && t >= T.hover && t < T.click;
    const sel = !after && t >= T.click;
    const seats: SceneSeat[] = this.lobbyRigs.map((rig, i) => ({ rig, look: i === c.pick && sel ? 'selected' : 'idle', hover: i === c.pick && hover }));
    this.drawScene(out, this.lobbyR.render({ now: ms(t), seats }));
    this.lobbyL.seats.forEach((s, i) => nameTag(out, s.label, c.tags[i], i === c.pick && sel ? P.yellow : this.label));
    const r = this.roundLeft(t);
    // the next round's room: the round is settled, the coins and rating are in
    const coins = after ? c.balance + c.result.coinsDelta : c.balance;
    const rating = after ? c.rating + c.result.ratingDelta : c.rating;
    const stats: HudStat[] = [
      { label: 'ROUND', value: fmt(r), icon: icon('clock') },
      { label: 'COINS', value: fmtCoins(coins), icon: icon('coin') },
      { label: 'RATING', value: String(rating), icon: icon('star') },
      { label: 'CALLED', value: '0/10', icon: icon('check') },
    ];
    hud(out, this.kit, c.level, stats, t);
    if (o.cursor && t >= T.cursorIn) {
      const p = this.pickPoint();
      const at = this.cursorPath(t, [[T.cursorIn, 1960, 1150], [T.hover, p.x, p.y]]);
      cursor(out, at.x, at.y, t >= T.click ? t - T.click : -1);
    }
  }

  // ---------------------------------------------------------------- seat dialog

  private static readonly DLG = { x: 400, y: 112, w: 1120, h: 728 };

  renderSeat(out: Rgba, t: number): void {
    const c = this.c, T = c.times, kit = this.kit;
    this.renderLobby(out, t);
    dim(out, 2, 0, 64, OUT_W, OUT_H - 64);
    const age = t - T.dialog;
    const closing = t >= T.close;
    if (closing && t - T.close > 2 / 24) return;
    const lift = closing ? 16 : age < 1 / 24 ? 32 : age < 2 / 24 ? 12 : 0;
    const D = Playthrough.DLG;
    const x = D.x, y = D.y + lift;
    nine(out, kit.ui.panel, x, y, D.w, D.h, 4);
    // close button
    nine(out, kit.ui.button.up, x + D.w - 96, y + 32, 60, 56, 4);
    drawTextC(out, '×', x + D.w - 66, y + 47, { color: P.navyDark, scale: 4 });
    // the portrait: the character larger on a lit pedestal
    const pb = renderPortrait(c.theme, this.pickRig, ms(t), 64, 76, { selected: true });
    rectOut(out, x + 40, y + 40, 64 * 4 + 16, 76 * 4 + 16, P.black);
    rectOut(out, x + 44, y + 44, 64 * 4 + 8, 76 * 4 + 8, P.slate);
    blitK(out, pb, x + 48, y + 48, 4);
    // the column
    const cx = x + 48 + 256 + 52;
    const colW = x + D.w - 48 - cx;
    let yy = y + 52;
    drawText(out, 'CHAT FOR TWO MINUTES WITH', cx, yy, { color: P.grey, scale: 3 });
    yy += 21 + 18;
    drawText(out, this.pickTag, cx, yy, { color: P.cream, scale: 7, outline: P.black, extrude: P.tan });
    yy += 49 + 7 + 26;
    for (const row of wrap('Then make your call: real human, yes or no?', Math.floor(colW / 4))) {
      drawText(out, row, cx, yy, { color: P.greyLight, scale: 4 });
      yy += 40;
    }
    yy += 22;
    drawText(out, 'PUT COINS ON THE TABLE', cx, yy, { color: P.white, scale: 3 });
    yy += 21 + 18;
    // presets: the largest one the wallet covers is the primary
    const bw = 208, bh = 108, gap = 22;
    const best = Math.max(...c.presets.filter((p) => p <= c.balance));
    c.presets.forEach((p, i) => {
      const bx = cx + i * (bw + gap);
      const isPick = p === c.play;
      const pressed = isPick && t >= T.clickCoins && t < T.clickCoins + 0.16;
      const hover = isPick && t >= T.onCoins && t < T.clickCoins + 0.3;
      if (isPick) this.anchors.coins = { x: bx, y: yy, w: bw, h: bh };
      const set = p === best ? kit.ui.buttonPrimary : kit.ui.button;
      if (hover) rectOut(out, bx - 8, yy - 8, bw + 16, bh + 16, P.white);
      nine(out, pressed ? set.down : set.up, bx, yy + (pressed ? 4 : 0), bw, bh, 4);
      const n = String(p);
      const coin = icon('coin');
      const rw = coin.w * 4 + 14 + textW(n) * 6;
      const rx = even(bx + bw / 2 - rw / 2), ry = yy + 14 + (pressed ? 4 : 0);
      blitK(out, coin, rx, ry + 2, 4);
      drawText(out, n, rx + coin.w * 4 + 14, ry, { color: P.navyDark, scale: 6 });
      drawTextC(out, '$' + (p * c.usdPerCoin).toFixed(2), bx + bw / 2, ry + 52, { color: P.navy, scale: 3 });
    });
    yy += bh + 22;
    // custom amount
    rectOut(out, cx, yy, 300, 64, P.black);
    rectOut(out, cx + 4, yy + 4, 292, 56, P.white);
    drawText(out, `${c.presets[0]}-${c.balance}`, cx + 20, yy + 18, { color: P.grey, scale: 4 });
    nine(out, kit.ui.button.up, cx + 320, yy, 210, 64, 4);
    drawTextC(out, 'CUSTOM', cx + 425, yy + 16, { color: P.navyDark, scale: 4 });
    yy += 64 + 22;
    drawText(out, 'Right calls share the coins of wrong ones.', cx, yy, { color: P.grey, scale: 3 });
    yy += 32;
    const have = 'You have ';
    drawText(out, have, cx, yy, { color: P.grey, scale: 3 });
    const nx = cx + textW(have) * 3;
    blitK(out, icon('coin'), nx, yy - 3, 3);
    drawText(out, `${c.balance}.`, nx + 7 * 3 + 6, yy, { color: P.grey, scale: 3 });
    yy += 21 + 26;
    nine(out, kit.ui.button.up, cx, yy, 270, 72, 4);
    drawTextC(out, 'PLAY FREE', cx + 135, yy + 20, { color: P.navyDark, scale: 4 });
    // the cursor: from the pedestal to the preset
    if (t >= T.dialog) {
      const from = this.pickPoint();
      const a = this.anchors.coins;
      const at = this.cursorPath(t, [[T.toCoins, from.x, from.y], [T.onCoins, a.x + a.w * 0.58, a.y + a.h * 0.62]]);
      cursor(out, at.x, at.y, t >= T.clickCoins ? t - T.clickCoins : -1);
    }
  }

  // ---------------------------------------------------------------- countdown

  private door(side: 'me' | 'them', flash: boolean): Rgba {
    const key = side + flash;
    let d = this.doorCache.get(key);
    if (!d) {
      const cx = DW / 2, cy = 47, slant = 0.2;
      d = renderVsDoor(this.c.theme, side, DW, DH, { cx, cy, seamTop: cx + cy * slant, seamBottom: cx - (DH - cy) * slant, rays: 14 });
      if (flash)
        for (let y = 0; y < d.h; y++)
          for (let x = 0; x < d.w; x++) {
            const col = get(d, x, y);
            if (col !== TRANSPARENT) px(d, x, y, lighter(col, 1));
          }
      this.doorCache.set(key, d);
    }
    return d;
  }

  renderCountdown(out: Rgba, t: number): void {
    const c = this.c, T = c.times;
    const open = clamp01((t - T.doors) / 0.32);
    if (open > 0) this.renderChat(out, t);
    else fillOut(out, P.black);
    const stage = t >= T.go ? 'go' : t >= T.count1 ? '1' : t >= T.count2 ? '2' : '3';
    const since = t - (stage === 'go' ? T.go : stage === '1' ? T.count1 : stage === '2' ? T.count2 : T.count3);
    const flash = since < 2 / 24;
    const slide = Math.round((open * open * 1100) / 10) * 10;
    blitK(out, this.door('me', flash), -slide, 0, DOOR_U);
    blitK(out, this.door('them', flash), slide, 0, DOOR_U);
    if (open >= 1) return;
    const st = countdownStyle(c.theme);
    const k = 10;
    const fy = 1080 - 40 - 96 - 48 * k + 28;
    this.pickRig.lookToward(-1);
    blitK(out, this.meRig.frame(ms(t), { shadow: true }), 48 - slide, fy, k);
    blitK(out, this.pickRig.frame(ms(t), { shadow: true }), OUT_W - 48 - 32 * k + slide, fy, k);
    plate(out, 40 - slide, 1080 - 40 - 96, 'YOU', c.me.name, st.me[0]);
    plate(out, OUT_W - 40 - 380 + slide, 1080 - 40 - 96, 'REAL HUMAN?', this.pickTag, st.them[0]);
    const vs = countdownSprite(c.theme, 'vs');
    blitK(out, vs, even(960 - (vs.w * 4) / 2), 1080 - 36 - vs.h * 4, 4);
    if (stage !== 'go') {
      const line = 'CHAT STARTS IN ';
      const w = (textW(line) + textW(stage)) * 5 + 60;
      const x = even(960 - w / 2);
      nine(out, this.kit.ui.plate, x, 32, w, 78, 3);
      drawText(out, line, x + 30, 48, { color: P.white, scale: 5 });
      drawText(out, stage, x + 30 + textW(line) * 5, 48, { color: P.gold, scale: 5 });
    }
    const spr = countdownSprite(c.theme, stage === 'go' ? 'go' : (stage as `${number}`));
    const kk = stage === 'go' ? 11 : 12;
    const kn = kk + (since < 3 / 24 ? 2 : 0);
    blitK(out, spr, even(960 - (spr.w * kn) / 2) - slide * (stage === 'go' ? 0 : 1), even(480 - (spr.h * kn) / 2), kn);
  }

  // ---------------------------------------------------------------- chat

  /** Seconds left on the chat clock. */
  private chatLeft(t: number): number {
    const T = this.c.times;
    return Math.max(0, Math.min(120, 120 * (1 - (t - T.chatFrom) / (T.chatTo - T.chatFrom))));
  }

  /** The chat screen before the chat: the coins going on the table, then matched (web/src/screens/Chat.tsx). */
  renderStatus(out: Rgba, t: number): void {
    const T = this.c.times;
    this.renderChat(out, t);
    const col = O(this.chatL.chat);
    const text = t >= T.matched ? 'Matched! Getting ready...' : `Putting ${this.c.play} coins on the table...`;
    const w = textW(text) * 4 + 80, h = 92;
    const x = col.x + 18, y = col.y + 24;
    const age = t - (t >= T.matched ? T.matched : T.placing);
    nine(out, this.kit.ui.panel, x, y + (age < 1 / 24 ? 12 : 0), w, h, 3);
    drawText(out, text, x + 40, y + 32 + (age < 1 / 24 ? 12 : 0), { color: P.greyLight, scale: 4 });
  }

  renderChat(out: Rgba, t: number): void {
    const c = this.c, T = c.times, kit = this.kit, L = this.chatL;
    const left = this.chatLeft(t);
    // she talks for a moment as each of her messages lands
    this.pickRig.lookToward(1);
    this.pickRig.setTalking(c.chat.some((m) => m.from === 'them' && t >= m.at && t < m.at + Math.min(2.2, 0.5 + m.text.length * 0.04)));
    this.drawScene(out, this.chatR.render({ now: ms(t), partner: this.pickRig, fuse: left / 120 }));
    this.pickRig.setTalking(false);
    nameTag(out, L.partner.label, this.pickTag, this.label);
    // the facts box under the partner
    const inf = O(L.info);
    nine(out, kit.ui.panel, inf.x, inf.y, inf.w, 178, 3);
    blitK(out, icon('coin'), inf.x + 21, inf.y + 18, 3);
    drawRuns(out, [{ text: 'Playing ' }, { text: String(c.play), color: P.gold }, { text: ' coins' }], inf.x + 51, inf.y + 21, { color: P.greyLight, scale: 3 });
    blitK(out, icon('chat'), inf.x + 18, inf.y + 60, 3);
    drawText(out, 'Two minutes, then you call it:', inf.x + 51, inf.y + 60, { color: P.greyLight, scale: 3 });
    drawText(out, 'REAL HUMAN?', inf.x + 51, inf.y + 93, { color: P.gold, scale: 3 });
    blitK(out, icon('link'), inf.x + 21, inf.y + 132, 3);
    drawText(out, 'play on chain', inf.x + 51, inf.y + 132, { color: P.gold, scale: 3 });
    rectOut(out, inf.x + 51, inf.y + 132 + 24, textW('play on chain') * 3, 3, P.gold);
    // the column: bubbles stacked from the input row up, older ones scrolling off the top
    const col = O(L.chat);
    const iy = CHAT_BOTTOM - 66;
    this.messages(out, t, { x: col.x, y: col.y, w: col.w, h: iy - 14 - col.y });
    // the input row
    nine(out, kit.ui.panel, col.x, iy, col.w, 66, 3);
    rectOut(out, col.x + 15, iy + 15, col.w - 180, 36, P.white);
    const typing = c.chat.find((m) => m.from === 'me' && t >= m.typeFrom && t < m.at);
    if (typing) {
      const dur = Math.max(0.2, typing.at - typing.typeFrom - 0.2);
      const n = Math.min(typing.text.length, Math.floor(((t - typing.typeFrom) / dur) * typing.text.length) + 1);
      const shown = typing.text.slice(0, n);
      drawText(out, shown, col.x + 27, iy + 21, { color: P.black, scale: 3 });
      if (Math.floor(t / 0.25) % 2 === 0 || n < typing.text.length) rectOut(out, col.x + 27 + textW(shown) * 3 + 4, iy + 19, 3, 27, P.black);
    } else drawText(out, 'Type a message...', col.x + 27, iy + 21, { color: P.grey, scale: 3 });
    const sending = c.chat.some((m) => m.from === 'me' && t >= m.at - 0.12 && t < m.at + 0.04);
    nine(out, sending ? kit.ui.buttonPrimary.down : kit.ui.buttonPrimary.up, col.x + col.w - 150, iy + 12 + (sending ? 3 : 0), 135, 42, 3);
    drawTextC(out, 'SEND', col.x + col.w - 82, iy + 20 + (sending ? 3 : 0), { color: P.navyDark, scale: 3 });
    hud(out, kit, c.level, [
      { label: 'CHAT', value: fmt(Math.ceil(left)), icon: icon('flame') },
      { label: 'PLAYING', value: String(c.play), icon: icon('coin') },
      { label: 'ROUND', value: fmt(this.roundLeft(t)), icon: icon('clock') },
    ], t);
  }

  private messages(out: Rgba, t: number, box: { x: number; y: number; w: number; h: number }): void {
    const c = this.c, m = this.bm, st = this.bs;
    const items: { i: number; h: number; w: number; dots: boolean; start: number }[] = [];
    c.chat.forEach((msg, i) => {
      const size = bubbleSize(this.rows[i], m);
      if (msg.from === 'me' && t >= msg.at) items.push({ i, h: size.h, w: size.w, dots: false, start: msg.at });
      if (msg.from === 'them' && t >= msg.typeFrom) {
        const dots = t < msg.at;
        const grow = ease((t - msg.typeFrom) / 0.14);
        const full = dots ? m.dotsH : m.dotsH + (size.h - m.dotsH) * ease((t - msg.at) / 0.1);
        items.push({ i, h: full * grow, w: dots ? m.dotsW : size.w, dots, start: msg.typeFrom });
      }
    });
    if (!items.length) return;
    // newest at the bottom
    const buf = createBuffer(box.w, box.h);
    let y = box.h;
    const ys: number[] = [];
    for (let k = items.length - 1; k >= 0; k--) {
      y -= items[k].h;
      ys[k] = y;
      y -= m.gap * Math.min(1, items[k].h / 20);
    }
    const inset = 18;
    items.forEach((it, k) => {
      const msg = c.chat[it.i];
      const h = Math.round(it.h / m.k) * m.k;
      if (h < m.k * 3) return;
      const by = even(ys[k]);
      if (by + h < -60) return;
      const s = msg.from === 'me' ? st.me : st.them;
      const x = msg.from === 'me' ? box.w - inset - it.w : inset;
      const pop = !it.dots && t - msg.at < 0.12 ? -m.k : 0;
      if (it.dots) drawDots(buf, s, m, x, by, Math.min(h, m.dotsH), t - msg.typeFrom);
      else drawBubble(buf, s, m, x, by + pop, it.w, h, this.rows[it.i], Infinity);
    });
    blitK(out, buf, box.x, box.y, 1);
  }

  // ---------------------------------------------------------------- call

  renderCall(out: Rgba, t: number): void {
    const c = this.c, T = c.times, kit = this.kit, L = this.callL;
    const locked = t >= T.clickNo + 0.2;
    this.pickRig.lookToward(0);
    if (t >= T.clickNo) this.pickRig.react(c.truth === 'bot' ? 'shrug' : 'nod', ms(T.clickNo + 0.2));
    this.drawScene(out, this.callR.render({ now: ms(t), partner: this.pickRig }));
    nameTag(out, L.partner.label, this.pickTag, this.label);
    const yes = O(L.yes), no = O(L.no);
    const drawn = (o: { x: number; y: number; w: number; h: number }) => ({ x: o.x, y: Math.round(o.y + o.h / 2 - 44) - 12, w: o.w, h: 88 });
    if (!locked) {
      // the question
      const q = O(L.question);
      const qh = 132;
      nine(out, kit.ui.panel, 960 - 320, q.y, 640, qh, 4);
      drawTextC(out, 'Real human?', 960, q.y + 20, { color: P.cream, scale: 6, outline: P.black, extrude: P.tan });
      const left = Math.max(0, c.callSeconds - Math.floor(t - T.callFrom));
      const clk = icon('clock');
      const line = `${fmt(left)} to make your call`;
      const lw = textW(line) * 3 + clk.w * 3 + 12;
      const lx = even(960 - lw / 2);
      blitK(out, clk, lx, q.y + qh - 46, 3);
      drawText(out, line, lx + clk.w * 3 + 12, q.y + qh - 45, { color: P.greyLight, scale: 3 });
      // the cursor: in from below, onto YES, a pause, over to NO, click
      const Y = drawn(yes), N = drawn(no);
      const at = this.cursorPath(t, [[T.callCursorIn, 1000, 1150], [T.hoverYes, Y.x + Y.w * 0.55, Y.y + Y.h * 0.6], [T.hoverNo - 0.45, Y.x + Y.w * 0.6, Y.y + Y.h * 0.55], [T.hoverNo, N.x + N.w * 0.45, N.y + N.h * 0.55]]);
      const inside = (o: { x: number; y: number; w: number; h: number }) => at.x >= o.x && at.x < o.x + o.w && at.y >= o.y && at.y < o.y + o.h;
      const hover = t >= T.callCursorIn && inside(Y) ? 'yes' : t >= T.callCursorIn && inside(N) ? 'no' : '';
      for (const which of ['yes', 'no'] as const) {
        const o = which === 'yes' ? Y : N;
        const set = which === 'yes' ? kit.ui.buttonYes : kit.ui.buttonNo;
        const pressed = which === 'no' && t >= T.clickNo;
        if (hover === which) {
          rectOut(out, o.x - 8, o.y - 4, o.w + 16, o.h + 8, P.cyan);
          rectOut(out, o.x - 4, o.y - 8, o.w + 8, o.h + 16, P.cyan);
        }
        const dy = pressed ? 4 : 0;
        nine(out, pressed ? set.down : set.up, o.x, o.y + dy, o.w, o.h, 4);
        const ic = icon(which === 'yes' ? 'user' : 'bot');
        const label = which === 'yes' ? 'YES' : 'NO';
        const w = ic.w * 4 + 20 + textW(label) * 6;
        const x = even(o.x + o.w / 2 - w / 2);
        blitK(out, ic, x, o.y + dy + 40 - (ic.h * 4) / 2, 4);
        drawText(out, label, x + ic.w * 4 + 20, o.y + dy + 18, { color: P.white, scale: 6, outline: P.black });
      }
      if (t >= T.callCursorIn) cursor(out, at.x, at.y, t >= T.clickNo ? t - T.clickNo : -1);
    } else {
      // locked until the round ends, the round clock beside it
      const l = O(L.locked);
      const pw = l.w, ph = 452;
      const x = l.x, y = even(l.y + 120);
      const age = t - (T.clickNo + 0.2);
      const dy = age < 1 / 24 ? 24 : age < 2 / 24 ? 8 : 0;
      nine(out, kit.ui.panel, x, y + dy, pw, ph, 4);
      const cx = x + pw / 2;
      let yy = y + dy + 40;
      drawTextC(out, 'You called', cx, yy, { color: P.grey, scale: 4 });
      yy += 46;
      drawTextC(out, c.truth === 'bot' ? 'Bot' : 'Real human', cx, yy, { color: P.cream, scale: 8, outline: P.black, extrude: P.tan });
      yy += 56 + 8 + 34;
      const lockLine = 'Locked until the round ends';
      const lw = 9 * 3 + 12 + textW(lockLine) * 3;
      blitK(out, icon('lock'), even(cx - lw / 2), yy - 4, 3);
      drawText(out, lockLine, even(cx - lw / 2) + 9 * 3 + 12, yy, { color: P.white, scale: 3 });
      yy += 21 + 26;
      const clock = fmt(t >= T.spinTo ? 0 : this.roundLeft(t));
      const cw = 9 * 5 + 18 + textW(clock) * 7;
      blitK(out, icon('clock'), even(cx - cw / 2), yy + 4, 5);
      drawText(out, clock, even(cx - cw / 2) + 9 * 5 + 18, yy, { color: P.white, scale: 7, outline: P.black });
      yy += 49 + 34;
      const link = 'Call on chain';
      const kw = textW(link) * 3 + 12 + 8 * 3;
      drawText(out, link, even(cx - kw / 2), yy, { color: P.gold, scale: 3 });
      rectOut(out, even(cx - kw / 2), yy + 24, textW(link) * 3, 3, P.gold);
      blitK(out, icon('link'), even(cx - kw / 2) + textW(link) * 3 + 12, yy - 2, 3);
      yy += 21 + 30;
      nine(out, kit.ui.buttonPrimary.up, even(cx - 170), yy, 340, 66, 4);
      drawTextC(out, 'BACK TO ROOM', cx, yy + 18, { color: P.navyDark, scale: 4 });
    }
    const coinsNow = c.balance - c.play;
    hud(out, kit, c.level, [
      { label: 'ROUND', value: fmt(t >= T.spinTo ? 0 : this.roundLeft(t)), icon: icon('clock') },
      { label: 'COINS', value: fmtCoins(coinsNow), icon: icon('coin'), locked: String(c.play) },
      { label: 'RATING', value: String(c.rating), icon: icon('star') },
    ], t);
  }

  // ---------------------------------------------------------------- results

  private static readonly RES = { x: 96, y: 84, w: 1224 };

  renderResults(out: Rgba, t: number): void {
    this.renderLobby(out, t, { after: true });
    dim(out, 2, 0, 64, OUT_W, OUT_H - 64);
    this.resultsPanel(out, t);
    const T = this.c.times;
    if (t >= T.toVerify) {
      const b = this.verifyBtn;
      const at = this.cursorPath(t, [[T.toVerify, 1500, 1120], [T.clickVerify - 0.25, b.x + b.w * 0.6, b.y + b.h * 0.62]]);
      cursor(out, at.x, at.y, t >= T.clickVerify ? t - T.clickVerify : -1);
    }
  }

  private verifyBtn = { x: 0, y: 0, w: 0, h: 0 };

  /** The results panel (web/src/screens/Results.tsx): the score, coins and rating, the chat revealed, the on-chain links. */
  private resultsPanel(out: Rgba, t: number, layoutOnly = false): void {
    const c = this.c, T = c.times, kit = this.kit;
    const R = Playthrough.RES;
    const iw = R.w - 80;
    // the persona card's rows decide the row's height, and the row the panel's
    const tx0 = R.x + 40 + 208;
    const pw = R.x + 40 + iw - 28 - tx0;
    const frows = wrap(c.persona.facts.join(' · '), Math.floor((pw - 44) / 3));
    // the emoji note keeps together (non-breaking spaces)
    const NBSP = String.fromCharCode(0xa0);
    const srows = wrap(`"${c.persona.style}" ·${NBSP}${c.persona.emoji.split(' ').join(NBSP)}`, Math.floor((pw - 44) / 3));
    const ph = 18 + 24 + 14 + (frows.length + srows.length) * 30 + 10;
    const rowH = 108 + ph + 16 + 50 + 28 + 22;
    const H = 116 + 80 + 12 + 100 + 14 + rowH + 20 + 21 + 26;
    const age = t - T.resultsFrom;
    const lift = layoutOnly ? 0 : age < 1 / 24 ? 40 : age < 2 / 24 ? 14 : 0;
    const x = R.x, y = R.y + lift;
    const ix = x + 40, tx = ix + 208;
    nine(out, kit.ui.panel, x, y, R.w, H, 4);
    drawText(out, `Round ${c.roundNo} results`, ix, y + 34, { color: P.cream, scale: 7, outline: P.black, extrude: P.tan });
    nine(out, kit.ui.button.up, x + R.w - 40 - 150, y + 32, 150, 58, 4);
    drawTextC(out, 'BACK', x + R.w - 40 - 75, y + 48, { color: P.navyDark, scale: 4 });
    const box = (bx: number, by: number, bw: number, bh: number) => {
      rectOut(out, bx, by, bw, bh, P.black);
      rectOut(out, bx + 4, by + 4, bw - 8, bh - 8, P.navyDark);
    };
    // the score
    let yy = y + 116;
    box(ix, yy, iw, 80);
    drawTextC(out, [{ text: 'You called ' }, { text: '1', color: P.gold }, { text: ' of ' }, { text: '1', color: P.gold }, { text: ' right' }], ix + iw / 2, yy + 19, { color: P.white, scale: 6 });
    yy += 80 + 12;
    // coins and rating, counting up
    const counting = layoutOnly ? 1 : clamp01((t - T.coinsFrom) / (T.coinsTo - T.coinsFrom));
    const delta = c.result.coinsDelta * counting;
    const dRating = Math.round(c.result.ratingDelta * counting);
    box(ix, yy, 430, 100);
    drawText(out, 'COINS', ix + 24, yy + 14, { color: P.grey, scale: 3 });
    blitK(out, icon('coin'), ix + 24, yy + 48, 4);
    const ds = '+' + delta.toFixed(2);
    drawText(out, ds, ix + 24 + 7 * 4 + 14, yy + 48, { color: P.white, scale: 5 });
    drawText(out, `($${(c.result.coinsDelta * c.usdPerCoin).toFixed(2)})`, ix + 24 + 7 * 4 + 14 + textW(ds) * 5 + 14, yy + 56, { color: P.grey, scale: 3 });
    this.anchors.coinsDelta = { x: ix + 24 + 7 * 4 + 14 + (textW(ds) * 5) / 2, y: yy + 48 };
    box(ix + 446, yy, 500, 100);
    drawText(out, 'RATING', ix + 470, yy + 14, { color: P.grey, scale: 3 });
    blitK(out, icon('star'), ix + 470, yy + 46, 4);
    drawRuns(out, [{ text: `${c.rating} → ` }, { text: String(c.rating + dRating), color: P.white }, { text: `  (+${dRating})`, color: P.lime }], ix + 470 + 11 * 4 + 14, yy + 50, { color: P.greyLight, scale: 4 });
    yy += 100 + 14;
    // the chat, revealed
    box(ix, yy, iw, rowH);
    if (layoutOnly || t >= T.right) rectOut(out, ix + 4, yy + 4, 12, rowH - 8, P.lime);
    rectOut(out, ix + 32, yy + 36, 152, 200, P.black);
    blitK(out, this.pickRig.frame(ms(t)), ix + 44, yy + 42, 4);
    let ty = yy + 28;
    drawText(out, this.pickTag, tx, ty, { color: P.white, scale: 5 });
    const nameW = textW(this.pickTag) * 5;
    const stamp = layoutOnly ? 1 : t - T.stamp;
    this.anchors.botTag = { x: tx + nameW + 24, y: ty };
    const isBot = c.truth === 'bot';
    if (stamp >= 0) {
      const big = stamp < 1 / 24 ? 6 : stamp < 2 / 24 ? 5 : 4;
      tag(out, isBot ? 'BOT' : 'HUMAN', tx + nameW + 24, ty - (big - 4) * 4, { bg: isBot ? P.blueDark : P.green, fg: P.white, scale: big });
      drawText(out, c.model, tx + nameW + 24 + textW(isBot ? 'BOT' : 'HUMAN') * 4 + 52, ty + 8, { color: P.grey, scale: 3 });
      drawRuns(out, [{ text: 'entered by ' }, { text: c.botmaster, color: P.white }], tx, ty + 48, { color: P.grey, scale: 3 });
      // the persona card: who the bot was playing, in a dashed gold frame
      const py = yy + 108;
      for (let d = 0; d < pw; d += 24) {
        rectOut(out, tx + d, py, Math.min(14, pw - d), 4, P.gold);
        rectOut(out, tx + d, py + ph - 4, Math.min(14, pw - d), 4, P.gold);
      }
      for (let d = 0; d < ph; d += 24) {
        rectOut(out, tx, py + d, 4, Math.min(14, ph - d), P.gold);
        rectOut(out, tx + pw - 4, py + d, 4, Math.min(14, ph - d), P.gold);
      }
      blitK(out, icon('mask'), tx + 22, py + 16, 3);
      drawRuns(out, [{ text: 'WAS PLAYING ', color: P.gold }, { text: c.persona.name, color: P.white }], tx + 22 + 9 * 3 + 12, py + 18, { color: P.gold, scale: 3 });
      let fy = py + 18 + 24 + 14;
      for (const r of frows) {
        drawText(out, r, tx + 22, fy, { color: P.white, scale: 3 });
        fy += 30;
      }
      for (const r of srows) {
        drawText(out, r, tx + 22, fy, { color: P.greyLight, scale: 3 });
        fy += 30;
      }
    }
    ty = yy + 108 + ph + 16;
    // the call and the verdict
    drawRuns(out, [{ text: 'You called ' }, { text: isBot ? 'BOT' : 'HUMAN', color: P.white }], tx, ty + 6, { color: P.greyLight, scale: 4 });
    if (layoutOnly || t >= T.right) {
      const ra = layoutOnly ? 1 : t - T.right;
      const s = ra < 1 / 24 ? 5 : 4;
      tag(out, 'Right', tx + textW('You called BOT') * 4 + 24, ty + 2 - (s - 4) * 4, { bg: P.green, fg: P.white, scale: s, icon: icon('check') });
    }
    ty += 50;
    // coins on this chat, rating, the room's split
    if (layoutOnly || t >= T.coinsFrom) {
      blitK(out, icon('coin'), tx, ty - 2, 4);
      const cs = '+' + delta.toFixed(2);
      drawText(out, cs, tx + 7 * 4 + 12, ty, { color: P.white, scale: 4 });
      let rx = tx + 7 * 4 + 12 + textW(cs) * 4 + 12;
      drawText(out, `on ${c.play} played`, rx, ty + 6, { color: P.grey, scale: 3 });
      rx += textW(`on ${c.play} played`) * 3 + 24;
      blitK(out, icon('star'), rx, ty - 2, 3);
      drawText(out, `+${dRating}`, rx + 11 * 3 + 8, ty, { color: P.lime, scale: 4 });
      rx += 11 * 3 + 8 + textW(`+${c.result.ratingDelta}`) * 4 + 24;
      const room = `${c.result.paidCalls} paid calls, ${Math.round(c.result.saidHuman * 100)}% said human`;
      drawText(out, room, rx, ty + 6, { color: P.greyLight, scale: 3 });
      this.anchors.saidHuman = { x: rx + textW(room) * 3 + 16, y: ty + 16 };
    }
    // verify
    const vb = { x: ix + iw - 28 - 236, y: yy + 26, w: 236, h: 76 };
    this.verifyBtn = vb;
    const pressed = !layoutOnly && t >= T.clickVerify && t < T.clickVerify + 0.15;
    const hov = !layoutOnly && t >= T.clickVerify - 0.25;
    if (hov) rectOut(out, vb.x - 8, vb.y - 8, vb.w + 16, vb.h + 16, P.white);
    nine(out, pressed ? kit.ui.buttonPrimary.down : kit.ui.buttonPrimary.up, vb.x, vb.y + (pressed ? 4 : 0), vb.w, vb.h, 4);
    blitK(out, icon('shield'), vb.x + 28, vb.y + 18 + (pressed ? 4 : 0), 4);
    drawText(out, 'VERIFY', vb.x + 28 + 9 * 4 + 16, vb.y + 24 + (pressed ? 4 : 0), { color: P.navyDark, scale: 4 });
    // on chain
    yy += rowH + 20;
    let lx = ix;
    drawText(out, 'On chain:', lx, yy, { color: P.grey, scale: 3 });
    lx += textW('On chain:') * 3 + 24;
    for (const [label, h] of c.result.links) {
      const s = `${label} ${h}`;
      drawText(out, s, lx, yy, { color: P.gold, scale: 3 });
      rectOut(out, lx, yy + 24, textW(s) * 3, 3, P.gold);
      blitK(out, icon('link'), lx + textW(s) * 3 + 8, yy - 3, 3);
      lx += textW(s) * 3 + 8 + 8 * 3 + 30;
    }
  }

  // ---------------------------------------------------------------- verify

  private static readonly DRAWER_W = 1180;

  renderVerify(out: Rgba, t: number): void {
    const T = this.c.times;
    this.renderLobby(out, t, { after: true });
    dim(out, 2, 0, 64, OUT_W, OUT_H - 64);
    this.resultsPanel(out, T.clickVerify + 0.5);
    dim(out, 2);
    // the drawer slides in from the right in four steps
    const u = Math.min(4, Math.floor(((t - T.verifyFrom) / 0.18) * 4)) / 4;
    const W = Playthrough.DRAWER_W;
    this.drawerPanel(out, t, Math.round((1 - u) * W));
  }

  /** The Verify drawer (web/src/screens/Verify.tsx): the verdict and the check groups, each check passing in turn. */
  private drawerPanel(out: Rgba, t: number, shift: number): void {
    const c = this.c, T = c.times, kit = this.kit;
    const W = Playthrough.DRAWER_W;
    const x = OUT_W - W + shift;
    this.anchors.drawer = { x: OUT_W - W, w: W };
    rectOut(out, x - 6, 0, 6, OUT_H, P.black);
    rectOut(out, x, 0, W, OUT_H, P.navyDark);
    const ix = x + 44, iw = W - 88;
    // header
    blitK(out, icon('shield'), ix, 30, 6);
    drawText(out, 'Verify this chat', ix + 9 * 6 + 24, 30, { color: P.gold, scale: 7, outline: P.black });
    nine(out, kit.ui.button.up, x + W - 44 - 170, 28, 170, 58, 4);
    drawTextC(out, 'CLOSE', x + W - 44 - 85, 44, { color: P.navyDark, scale: 4 });
    let yy = 116;
    for (const r of c.verify.intro) {
      drawText(out, r, ix, yy, { color: P.cream, scale: 3 });
      yy += 31;
    }
    yy += 10;
    // the verdict
    const done = t >= T.verdict;
    rectOut(out, ix, yy, iw, 68, P.black);
    rectOut(out, ix + 4, yy + 4, iw - 8, 60, done ? P.green : P.navy);
    if (done) {
      const ck = icon('check');
      blitK(out, ck, ix + 26, yy + 16, 4);
      drawText(out, `All ${c.verify.total} checks pass`, ix + 26 + ck.w * 4 + 20, yy + 16, { color: P.white, scale: 5 });
    } else {
      const n = c.times.checks.filter((ct) => t >= ct).length;
      drawText(out, `Checking in your browser... ${n}`, ix + 26, yy + 20, { color: P.greyLight, scale: 4 });
    }
    yy += 68 + 16;
    // the groups
    const groups: { x: number; y: number; w: number; h: number }[] = [];
    let k = 0;
    const PITCH = 40;
    for (const g of c.verify.groups) {
      const details = g.checks.filter((ch) => ch.detail).length;
      const lx0 = ix + 92 + 24 + 18;
      const noteRows = g.note ? wrap(g.note, Math.floor((ix + iw - 24 - lx0) / 3)) : [];
      const gh = 52 + g.checks.length * PITCH + details * 26 + noteRows.length * 30 + (g.links ? 34 : 0) + 8;
      groups.push({ x: ix, y: yy, w: iw, h: gh });
      rectOut(out, ix, yy, iw, gh, P.black);
      rectOut(out, ix + 4, yy + 4, iw - 8, gh - 8, P.navyDark);
      const passed = g.checks.every((_, j) => t >= (c.times.checks[k + j] ?? Infinity));
      rectOut(out, ix + 4, yy + 4, 12, gh - 8, passed ? P.lime : P.slate);
      checkBox(out, ix + 40, yy + 16, 28, passed ? 'pass' : 'wait');
      drawText(out, g.title, ix + 40 + 28 + 20, yy + 16, { color: P.white, scale: 4 });
      let ry = yy + 58;
      for (const ch of g.checks) {
        const ok = t >= (c.times.checks[k] ?? Infinity);
        checkBox(out, ix + 92, ry - 2, 24, ok ? 'pass' : 'wait');
        drawText(out, ch.label, lx0, ry, { color: ok ? P.white : P.grey, scale: 3 });
        ry += PITCH;
        if (ch.detail) {
          drawText(out, ch.detail, lx0, ry - 8, { color: P.grey, scale: 3 });
          ry += 26;
        }
        k++;
      }
      for (const r of noteRows) {
        drawText(out, r, lx0, ry, { color: P.grey, scale: 3 });
        ry += 30;
      }
      if (g.links) {
        let lx = lx0;
        for (const [label, h] of g.links) {
          const s = `${label} ${h}`;
          drawText(out, s, lx, ry, { color: P.gold, scale: 3 });
          rectOut(out, lx, ry + 24, textW(s) * 3, 3, P.gold);
          blitK(out, icon('link'), lx + textW(s) * 3 + 8, ry - 3, 3);
          lx += textW(s) * 3 + 8 + 8 * 3 + 30;
        }
      }
      yy += gh + 12;
    }
    this.anchors.verifyGroups = groups;
  }

  /** Draw one screen. */
  render(out: Rgba, screen: Screen, t: number): void {
    if (screen === 'lobby') this.renderLobby(out, t, { cursor: true });
    else if (screen === 'seat') this.renderSeat(out, t);
    else if (screen === 'status') this.renderStatus(out, t);
    else if (screen === 'countdown') this.renderCountdown(out, t);
    else if (screen === 'chat') this.renderChat(out, t);
    else if (screen === 'call') this.renderCall(out, t);
    else if (screen === 'results') this.renderResults(out, t);
    else this.renderVerify(out, t);
  }
}

function fmtCoins(n: number): string {
  const v = Math.round(n * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

void TRANSPARENT;
void highlight;
void (null as unknown as Run);
