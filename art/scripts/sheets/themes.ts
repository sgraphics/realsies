// Theme and scene contact sheets: lobby / chat / call / hall compositions per theme, prop frames,
// UI kits, layout flex test, logo. Characters come from the real rig.

import type { SheetOut } from '../sheets.ts';
import { type Rgba, createBuffer, blit, scaleUp, clear, rect, nineSlice } from '../../src/core/buffer.ts';
import { PAL } from '../../src/core/palette.ts';
import { rngFrom, randomSeed } from '../../src/core/rng.ts';
import { drawText } from '../../src/core/font.ts';
import { Rig } from '../../src/rig/rig.ts';
import type { ThemeId } from '../../../shared/protocol.ts';
import { THEMES } from '../../../shared/protocol.ts';
import { layoutLobby, layoutChat, layoutCall, layoutHall } from '../../src/scene/layout.ts';
import { SceneRenderer, renderPortrait } from '../../src/scene/renderer.ts';
import type { AnyLayout, SceneSeat, SceneState } from '../../src/scene/types.ts';
import { getThemeKit, getThemeDef } from '../../src/themes/index.ts';
import { drawLogo, LOGO_W, LOGO_H } from '../../src/themes/logo.ts';
import { Clip, newPaint } from '../../src/themes/util.ts';
import { planFor } from '../../src/scene/renderer.ts';

const seedRng = rngFrom('sheet');
const SEEDS = Array.from({ length: 16 }, () => randomSeed(seedRng));
const rigs = SEEDS.map((s) => new Rig(s));

function seatsFor(n: number): SceneSeat[] {
  return Array.from({ length: n }, (_, i) => ({
    rig: rigs[i % rigs.length],
    look: i === 2 ? 'selected' : i === 6 ? 'dim' : i === 8 ? 'empty' : 'idle',
    hover: i === 4,
  }));
}

function render(theme: ThemeId, layout: AnyLayout, now: number, extra: Partial<SceneState> = {}): Rgba {
  const r = new SceneRenderer(theme, layout);
  const state: SceneState = { now, seats: seatsFor(10), partner: rigs[3], fuse: 0.62, ...extra };
  const f = r.render(state);
  const out = createBuffer(f.w, f.h);
  out.data.set(f.data);
  return out;
}

/** Outline the DOM rects of a layout (for checking placements) in a copy. */
function withRects(img: Rgba, layout: AnyLayout): Rgba {
  const out = createBuffer(img.w, img.h);
  out.data.set(img.data);
  const box = (r: { x: number; y: number; w: number; h: number }, c: number) => {
    for (let x = r.x; x < r.x + r.w; x++) {
      if ((x & 1) === 0) {
        out.data.set([c >> 16, (c >> 8) & 255, c & 255, 255], ((r.y) * out.w + x) * 4);
        out.data.set([c >> 16, (c >> 8) & 255, c & 255, 255], ((r.y + r.h - 1) * out.w + x) * 4);
      }
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      if ((y & 1) === 0) {
        out.data.set([c >> 16, (c >> 8) & 255, c & 255, 255], (y * out.w + r.x) * 4);
        out.data.set([c >> 16, (c >> 8) & 255, c & 255, 255], (y * out.w + r.x + r.w - 1) * 4);
      }
    }
  };
  const l: any = layout;
  const C = PAL.hotRed, D = PAL.cyan, E = PAL.lime;
  for (const k of ['info', 'chat', 'question', 'yes', 'no', 'locked', 'content']) if (l[k] && l[k].h > 0) box(l[k], k === 'chat' || k === 'content' ? D : C);
  for (const s of l.seats ?? []) box(s.label, E);
  if (l.partner) box(l.partner.label, E);
  return out;
}

function vstack(imgs: Rgba[], gap = 2, bg = PAL.black): Rgba {
  const w = Math.max(...imgs.map((i) => i.w)), h = imgs.reduce((a, b) => a + b.h + gap, 0);
  const out = createBuffer(w, h);
  clear(out, bg);
  let y = 0;
  for (const i of imgs) {
    blit(out, i, 0, y);
    y += i.h + gap;
  }
  return out;
}

function hstack(imgs: Rgba[], gap = 4, bg = PAL.black): Rgba {
  const w = imgs.reduce((a, b) => a + b.w + gap, gap), h = Math.max(...imgs.map((i) => i.h)) + gap * 2;
  const out = createBuffer(w, h);
  clear(out, bg);
  let x = gap;
  for (const i of imgs) {
    blit(out, i, x, gap);
    x += i.w + gap;
  }
  return out;
}

export async function sheetsThemes(out: SheetOut): Promise<void> {
  const only = process.env.THEME as ThemeId | undefined;
  const themes = only ? [only] : THEMES;
  const now = 1840;
  for (const t of themes) {
    const lobby = layoutLobby(480, 270);
    out(`lobby-${t}`, scaleUp(render(t, lobby, now), 2));
    out(`lobby-${t}-rects`, scaleUp(withRects(render(t, lobby, now), lobby), 2));
    {
      const full = render(t, lobby, now);
      const z = (x: number, y: number, w: number, h: number) => {
        const c = createBuffer(w, h);
        blit(c, full, 0, 0, { sx: x, sy: y, sw: w, sh: h });
        return scaleUp(c, 4);
      };
      out(`zoom-${t}-a`, z(0, 0, 240, 135));
      out(`zoom-${t}-b`, z(200, 120, 240, 135));
    }
    const lp = layoutLobby(270, 480);
    out(`lobby-${t}-portrait`, scaleUp(render(t, lp, now), 2));
    const chat = layoutChat(480, 270);
    out(`chat-${t}`, scaleUp(render(t, chat, now), 2));
    out(`chat-${t}-rects`, scaleUp(withRects(render(t, chat, now), chat), 2));
    {
      const full = render(t, chat, now);
      const c = createBuffer(240, 60);
      blit(c, full, 0, 0, { sx: 100, sy: 0, sw: 240, sh: 60 });
      out(`zoom-${t}-fuse`, scaleUp(c, 4));
    }
    const cp = layoutChat(270, 480);
    out(`chat-${t}-portrait`, scaleUp(withRects(render(t, cp, now), cp), 2));
    const call = layoutCall(480, 270);
    out(`call-${t}`, scaleUp(withRects(render(t, call, now), call), 2));
    const hall = layoutHall(480, 270, 6);
    out(`hall-${t}`, scaleUp(withRects(render(t, hall, now, { seats: seatsFor(6).map((s) => ({ ...s, look: 'idle' as const })) }), hall), 2));
    // props: each prop's area over 8 frames, side by side (rows = props)
    {
      const r = new SceneRenderer(t, lobby);
      const rows: Rgba[] = [];
      for (const pr of r.propList()) {
        if (!pr.at) continue;
        const a = { x: Math.max(0, Math.round(pr.at.x)), y: Math.max(0, Math.round(pr.at.y)), w: Math.round(Math.min(pr.at.w, 160)), h: Math.round(Math.min(pr.at.h, 70)) };
        const fr: Rgba[] = [];
        for (let i = 0; i < 8; i++) {
          const f = r.render({ now: 1000 + i * (pr.name === 'bat' ? 450 : pr.name === 'drip' ? 330 : 140), seats: [] });
          const c = createBuffer(a.w, a.h);
          blit(c, f, 0, 0, { sx: a.x, sy: a.y, sw: a.w, sh: a.h });
          fr.push(c);
        }
        rows.push(hstack(fr, 2));
      }
      if (rows.length) out(`props-${t}`, scaleUp(vstack(rows), 3));
    }
    // UI kit
    out(`ui-${t}`, scaleUp(uiSheet(t), 3));
    // portrait helper
    const pr = [renderPortrait(t, rigs[1], now), renderPortrait(t, rigs[5], now, 64, 76, { selected: true }), renderPortrait(t, null, now)];
    out(`portrait-${t}`, scaleUp(hstack(pr), 3));
  }
  // layout flex test
  const sizes: [number, number][] = [[400, 225], [580, 260], [225, 400], [320, 480]];
  const t0 = only ?? 'castle';
  out('lobby-sizes', scaleUp(hstack(sizes.map(([w, h]) => withRects(render(t0, layoutLobby(w, h), now), layoutLobby(w, h))), 6), 2));
  out('chat-sizes', scaleUp(hstack(sizes.map(([w, h]) => withRects(render(t0, layoutChat(w, h), now), layoutChat(w, h))), 6), 2));
  // logo
  const lb = createBuffer(LOGO_W + 8, LOGO_H * 3 + 16);
  clear(lb, PAL.navy);
  drawLogo(lb, 4, 4, 0);
  drawLogo(lb, 4, LOGO_H + 8, 600);
  drawLogo(lb, 4, LOGO_H * 2 + 12, 3400);
  out('logo', scaleUp(lb, 4));
  // contrast: bubble text on its fill (WCAG 4.5:1) and the bubble against the dimmed room behind the chat (3:1)
  contrastReport(themes, now);
  // timing
  const lay = layoutLobby(480, 270);
  const rr = new SceneRenderer('castle', lay);
  rr.render({ now: 0, seats: seatsFor(10) });
  const tt = performance.now();
  for (let i = 0; i < 100; i++) rr.render({ now: i * 66, seats: seatsFor(10) });
  console.log(`  render 480x270 lobby: ${((performance.now() - tt) / 100).toFixed(2)} ms/frame`);
  void newPaint; void Clip; void planFor; void getThemeDef; void drawText;
}

function uiSheet(t: ThemeId): Rgba {
  const kit = getThemeKit(t);
  const ui = kit.ui;
  const b = createBuffer(200, 120);
  clear(b, PAL.navyDark);
  nineSlice(b, ui.panel.img, ui.panel.slice, 4, 4, 70, 40);
  let x = 80;
  for (const s of [ui.button, ui.buttonPrimary, ui.buttonYes, ui.buttonNo]) {
    nineSlice(b, s.up.img, s.up.slice, x, 4, 26, 14);
    nineSlice(b, s.down.img, s.down.slice, x, 20, 26, 14);
    nineSlice(b, s.disabled.img, s.disabled.slice, x, 36, 26, 14);
    x += 28;
  }
  nineSlice(b, ui.bubbleThem.img, ui.bubbleThem.slice, 8, 56, 70, 18);
  blit(b, ui.tailThem, 8 + 2, 56 + 17);
  nineSlice(b, ui.bubbleMe.img, ui.bubbleMe.slice, 100, 56, 70, 18);
  blit(b, ui.tailMe, 100 + 70 - 9, 56 + 17);
  nineSlice(b, ui.plate.img, ui.plate.slice, 8, 86, 80, 12);
  nineSlice(b, ui.tab.up.img, ui.tab.up.slice, 100, 86, 24, 14);
  nineSlice(b, ui.tab.active.img, ui.tab.active.slice, 128, 86, 24, 14);
  rect(b, 8, 104, 12, 6, parseInt(kit.colors.accent.slice(1), 16));
  return b;
}

// ---------------------------------------------------------------- contrast

function relLum(c: number): number {
  const ch = [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export function contrastRatio(a: number, b: number): number {
  const la = relLum(a), lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const hexNum = (h: string) => parseInt(h.slice(1), 16);

/** Median luminance colour of the room inside a rect (the backdrop the bubbles sit on). */
function backdropAt(img: Rgba, r: { x: number; y: number; w: number; h: number }): number {
  const cs: number[] = [];
  for (let y = r.y; y < r.y + r.h; y += 2)
    for (let x = r.x; x < r.x + r.w; x += 2) {
      const i = (y * img.w + x) * 4;
      cs.push((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]);
    }
  cs.sort((a, b) => relLum(a) - relLum(b));
  return cs[Math.floor(cs.length * 0.75)]; // a bright-ish quartile: bubbles must clear most of the room
}

function contrastReport(themes: ThemeId[], now: number): void {
  const fails: string[] = [];
  for (const t of themes) {
    const kit = getThemeKit(t);
    const fillOf = (n: { img: Rgba }) => {
      const i = ((n.img.h >> 1) * n.img.w + (n.img.w >> 1)) * 4;
      return (n.img.data[i] << 16) | (n.img.data[i + 1] << 8) | n.img.data[i + 2];
    };
    const them = fillOf(kit.ui.bubbleThem), me = fillOf(kit.ui.bubbleMe);
    const tThem = contrastRatio(them, hexNum(kit.colors.bubbleThemText));
    const tMe = contrastRatio(me, hexNum(kit.colors.bubbleMeText));
    const rows: string[] = [`text them ${tThem.toFixed(1)}:1`, `text me ${tMe.toFixed(1)}:1`];
    if (tThem < 4.5) fails.push(`${t}: their bubble text ${tThem.toFixed(2)}:1`);
    if (tMe < 4.5) fails.push(`${t}: my bubble text ${tMe.toFixed(2)}:1`);
    for (const [w, h] of [[480, 270], [270, 480]] as const) {
      const l = layoutChat(w, h);
      const img = render(t, l, now);
      const bd = backdropAt(img, l.chat);
      const bThem = contrastRatio(them, bd), bMe = contrastRatio(me, bd);
      rows.push(`${w}x${h} backdrop: them ${bThem.toFixed(1)}:1 me ${bMe.toFixed(1)}:1`);
      if (bThem < 3) fails.push(`${t} ${w}x${h}: their bubble vs room ${bThem.toFixed(2)}:1`);
      if (bMe < 3) fails.push(`${t} ${w}x${h}: my bubble vs room ${bMe.toFixed(2)}:1`);
    }
    console.log(`  contrast ${t}: ${rows.join(', ')}`);
  }
  if (fails.length) {
    console.log('CONTRAST FAILURES:');
    for (const f of fails) console.log('  ' + f);
    process.exitCode = 1;
  }
}
