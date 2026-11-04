// SceneRenderer: composes a full frame (backdrop, wall, arch, frame, pedestals, characters, props,
// fuse) for a layout and theme. Static layers are cached; per frame it copies the cache and draws
// only what moves. The room behind the characters is dimmed through the palette (darker layers and
// a vignette away from the focus) so characters, gamertags and bubbles pop. Pure TS, no DOM.

import { type Rgba, createBuffer, blit, get, px, shadowEllipse } from '../core/buffer.ts';
import { TRANSPARENT, lighter, darker } from '../core/palette.ts';
import type { Rig } from '../rig/rig.ts';
import type { AnyLayout, PedestalState, SceneState, SeatSlot, ThemeId } from './types.ts';
import { extrasOf, PED_W, type LayoutExtras } from './layout.ts';
import { getThemeDef } from '../themes/index.ts';
import type { PedestalSprites, Prop, RoomDim, ScenePlan, ThemeDef } from '../themes/types.ts';
import { Clip, L_DECO, L_FLOOR, L_ARCH, L_WALL, L_FRAME, bayer, blitScaled, insideOpening, newPaint, type Opening, type Paint } from '../themes/util.ts';
import { drawLogo } from '../themes/logo.ts';
import { drawFuse } from '../themes/fuse.ts';
import { hash01 } from '../core/rng.ts';

interface Cache {
  key: string;
  bg: Rgba;
  mask: Uint8Array;
  /** Palette steps each pixel of the room was darkened by (props drawn there follow it). */
  dim: Uint8Array;
  props: Prop[];
  plan: ScenePlan;
}

export function planFor(theme: ThemeDef, layout: AnyLayout, extras: LayoutExtras = extrasOf(layout)): ScenePlan {
  const openings: Opening[] = extras.arches.map((a, i) => ({
    rect: a.rect,
    rise: theme.archRise(a.rect, a.rise, layout.kind),
    jag: theme.jag,
    seed: 31 + i,
  }));
  const main = openings[0];
  return { layout, extras, openings, inside: main ? (x, y) => insideOpening(main, x, y) : () => false };
}

const pedCache = new Map<ThemeId, PedestalSprites>();
export function pedestalsOf(id: ThemeId): PedestalSprites {
  let s = pedCache.get(id);
  if (!s) {
    s = getThemeDef(id).pedestalSprites();
    pedCache.set(id, s);
  }
  return s;
}

/** Draw a pedestal sprite at (x, y) (its 48x24 top-left). `scale` for the big partner. */
export function drawPedestal(dst: Rgba, theme: ThemeId, x: number, y: number, state: PedestalState | 'dim' | 'hover', now: number, scale = 1): void {
  const s = pedestalsOf(theme);
  const spr = state === 'selected' ? s.selected[Math.floor(now / 180) % s.selected.length] : state === 'empty' ? s.empty : state === 'dim' ? s.dim : state === 'hover' ? s.hover : s.occupied;
  if (scale === 1) blit(dst, spr, x, y);
  else blitScaled(dst, spr, x, y, scale);
}

/** A light column rising from a selected pedestal (lightens what is behind it). */
function drawBeam(out: Rgba, cx: number, baseY: number, w: number, h: number, now: number, frozen: boolean): void {
  const t0 = frozen ? 0 : now / 120;
  for (let y = baseY - h; y < baseY; y++) {
    const up = (baseY - y) / h; // 0 at the base, 1 at the top
    for (let x = Math.round(cx - w / 2); x < cx + w / 2; x++) {
      if (x < 0 || y < 0 || x >= out.w || y >= out.h) continue;
      const across = Math.abs(x + 0.5 - cx) / (w / 2);
      const shimmer = frozen ? 0 : 0.12 * Math.sin(t0 + y * 0.35 + x * 0.2);
      const v = (1 - up) * (1 - across * across) + shimmer;
      if (v <= bayer(x, y) * 0.9) continue;
      const c = get(out, x, y);
      if (c === TRANSPARENT) continue;
      px(out, x, y, lighter(c, v > 0.7 ? 2 : 1));
    }
  }
  // rising motes
  if (!frozen)
    for (let m = 0; m < 5; m++) {
      const per = 1600 + m * 230;
      const ph = ((now + m * 977) % per) / per;
      const mx = Math.round(cx - w / 2 + 3 + hash01(3, m, Math.floor((now + m * 977) / per)) * (w - 6));
      const my = Math.round(baseY - 2 - ph * h * 0.9);
      const c = get(out, mx, my);
      if (c !== TRANSPARENT) px(out, mx, my, lighter(c, 3));
    }
}

function drawCharacter(out: Rgba, rig: Rig, x: number, y: number, now: number, scale: number, dimSteps: number): void {
  if (scale === 1 && dimSteps === 0) {
    rig.draw(out, x, y, now);
    return;
  }
  // cast shadow under the feet (rig.draw does this itself at 1x)
  shadowEllipse(out, x + Math.round(9 * scale), y + 44 * scale, 14 * scale, 4 * scale, 1);
  blitScaled(out, rig.frame(now), x, y, scale, dimSteps);
}

const DIM_DEFAULT: RoomDim = { deep: 1, wall: 1, arch: 1, frame: 1, vignette: 1 };

/**
 * Darken the static room through the palette: per depth layer (deep backdrop, wall, arch border,
 * frame), plus a dithered vignette away from the focus rect and a calm zone behind DOM text
 * (chat bubbles). Returns the per-pixel steps so animated props can match.
 */
export function dimRoom(p: Paint, plan: ScenePlan, dim: Partial<RoomDim> = {}): Uint8Array {
  const d = { ...DIM_DEFAULT, ...dim };
  const { w, h } = p;
  const out = new Uint8Array(w * h);
  const f = plan.extras.focus;
  const fx = f.x + f.w / 2, fy = f.y + f.h / 2;
  const rx = Math.max(48, f.w * 0.62), ry = Math.max(36, f.h * 0.66);
  const calm = plan.extras.calm;
  const data = p.b.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = p.mask[i];
      let s = m <= L_FLOOR ? d.deep : m === L_WALL || m === L_DECO ? d.wall : m === L_ARCH ? d.arch : m === L_FRAME ? d.frame : d.wall;
      if (m !== L_FRAME) {
        const nx = (x + 0.5 - fx) / rx, ny = (y + 0.5 - fy) / ry;
        const r = Math.sqrt(nx * nx + ny * ny);
        s += Math.max(0, Math.min(1, (r - 0.85) * 1.1)) * d.vignette;
        for (const c of calm) {
          const e = Math.min(x - c.x, y - c.y, c.x + c.w - 1 - x, c.y + c.h - 1 - y);
          if (e >= 0) s += Math.min(1, (e + 1) / 4);
        }
      }
      if (s <= 0) continue;
      const whole = Math.floor(s);
      const k = whole + (s - whole > bayer(x, y) ? 1 : 0);
      if (!k) continue;
      out[i] = k;
      const j = i * 4;
      if (!data[j + 3]) continue;
      const c = darker((data[j] << 16) | (data[j + 1] << 8) | data[j + 2], k);
      data[j] = (c >> 16) & 255;
      data[j + 1] = (c >> 8) & 255;
      data[j + 2] = c & 255;
    }
  return out;
}

export class SceneRenderer {
  private theme: ThemeDef;
  private layout: AnyLayout;
  private cache: Cache | null = null;
  private out: Rgba;
  private clip = new Clip();

  constructor(theme: ThemeId, layout: AnyLayout) {
    this.theme = getThemeDef(theme);
    this.layout = layout;
    this.out = createBuffer(layout.w, layout.h);
  }

  get themeId(): ThemeId {
    return this.theme.id;
  }

  setTheme(id: ThemeId): void {
    if (id === this.theme.id) return;
    this.theme = getThemeDef(id);
    this.cache = null;
  }

  setLayout(layout: AnyLayout): void {
    if (layout === this.layout) return;
    this.layout = layout;
    if (this.out.w !== layout.w || this.out.h !== layout.h) this.out = createBuffer(layout.w, layout.h);
    this.cache = null;
  }

  /** The cached static background (no props, characters or logo), for tests and sheets. */
  background(): Rgba {
    return this.ensure().bg;
  }

  /** The animated props of the current composition (QA sheets). */
  propList(): Prop[] {
    return this.ensure().props;
  }

  private ensure(): Cache {
    const l = this.layout;
    const key = this.theme.id + ':' + l.kind + ':' + l.w + 'x' + l.h + ':' + l.orientation + ':' + JSON.stringify(extrasOf(l).focus);
    if (this.cache && this.cache.key === key) return this.cache;
    const t = this.theme;
    const plan = planFor(t, l);
    const p = newPaint(l.w, l.h);
    t.paintDeep(p, plan);
    t.paintWall(p, plan);
    for (const o of plan.openings) t.paintArch(p, o, plan);
    for (const r of plan.extras.pillars) t.paintPillar(p, r, plan);
    for (const r of plan.extras.plates) t.paintPlate(p, r);
    const props = t.props(p, plan);
    t.paintFrame(p);
    const dim = dimRoom(p, plan, t.dim);
    this.cache = { key, bg: p.b, mask: p.mask, dim, props, plan };
    return this.cache;
  }

  render(state: SceneState): Rgba {
    const c = this.ensure();
    const out = this.out;
    const now = state.now;
    const frozen = !!state.reducedMotion;
    const pnow = frozen ? 0 : now;
    out.data.set(c.bg.data);
    const clip = this.clip;
    for (const pr of c.props) if (pr.layer === 'far') pr.draw(clip.bind(out, c.mask, L_FLOOR, 0, pr.lit ? null : c.dim), pnow);
    for (const pr of c.props) if (pr.layer === 'mid') pr.draw(clip.bind(out, c.mask, L_DECO, 0, pr.lit ? null : c.dim), pnow);
    const l = this.layout;
    if (l.kind === 'lobby' || l.kind === 'hall') {
      const seats = state.seats ?? [];
      for (const slot of l.seats) this.drawSeat(slot, seats[slot.index], now, frozen);
    } else if (l.kind === 'chat') {
      this.drawSeat(l.partner, { rig: state.partner ?? null, look: state.partner ? 'idle' : 'empty' }, now, frozen);
    } else if (l.kind === 'call') {
      const k = l.partnerScale;
      const s = l.partner;
      if (state.partner) drawBeam(out, s.pedestal.x + s.pedestal.w / 2, s.pedestal.y + 4 * k, 28 * k, 50 * k, now, frozen);
      drawPedestal(out, this.theme.id, s.pedestal.x, s.pedestal.y, 'selected', pnow, k);
      if (state.partner) drawCharacter(out, state.partner, s.char.x, s.char.y, now, k, 0);
    }
    for (const pr of c.props) if (pr.layer === 'near') pr.draw(clip.bind(out, c.mask, L_DECO), pnow);
    const ex = c.plan.extras;
    if (ex.logoAt) drawLogo(out, ex.logoAt.x, ex.logoAt.y, now, 1, frozen);
    if (l.kind === 'chat' && state.fuse !== undefined) drawFuse(out, l.fuse, state.fuse, now, this.theme.fuse.rope, frozen);
    return out;
  }

  private drawSeat(slot: SeatSlot, seat: SceneState['seats'] extends (infer S)[] | undefined ? S | undefined : never, now: number, frozen: boolean): void {
    const out = this.out;
    const p = slot.pedestal;
    const k = slot.scale ?? 1;
    const look = seat?.look ?? 'empty';
    const rig = seat?.rig ?? null;
    const st: PedestalState | 'dim' | 'hover' = look === 'selected' ? 'selected' : look === 'dim' ? 'dim' : look === 'empty' || !rig ? 'empty' : seat?.hover ? 'hover' : 'occupied';
    if (look === 'selected') drawBeam(out, p.x + (PED_W * k) / 2, p.y + 6 * k, 34 * k, 54 * k, now, frozen);
    drawPedestal(out, this.theme.id, p.x, p.y, st, frozen ? 0 : now, k);
    if (rig && look !== 'empty') drawCharacter(out, rig, slot.char.x, slot.char.y, now, k, look === 'dim' ? 1 : 0);
  }
}

// ---------------------------------------------------------------- portraits

const portraitCache = new Map<string, Rgba>();

/**
 * A small framed portrait: themed backdrop, a pedestal and the character, for the seat dialog,
 * result rows and thumbnails. Size in game pixels; the character stands centred on the pedestal.
 */
export function renderPortrait(theme: ThemeId, rig: Rig | null, now: number, w = 64, h = 76, o: { selected?: boolean; dim?: boolean; reducedMotion?: boolean; out?: Rgba } = {}): Rgba {
  const key = theme + ':' + w + 'x' + h;
  let bg = portraitCache.get(key);
  const t = getThemeDef(theme);
  if (!bg) {
    const p = newPaint(w, h);
    const fake: any = { kind: 'hall', w, h, orientation: 'portrait', inner: { x: 0, y: 0, w, h }, content: { x: 0, y: 0, w, h }, seats: [] };
    const extras: LayoutExtras = { arches: [{ rect: { x: -2, y: -2, w: w + 4, h: h + 4 }, rise: 0 }], floorY: h - 20, pillars: [], plates: [], wallSpots: [], decor: [], focus: { x: 0, y: 0, w, h }, calm: [] };
    const plan: ScenePlan = { layout: fake, extras, openings: [{ rect: extras.arches[0].rect, rise: 0 }], inside: () => true };
    t.paintDeep(p, plan);
    // the same dimming as the room, so the character pops the same way
    dimRoom(p, plan, { ...t.dim, vignette: 0 });
    // soft vignette so the character pops
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const nx = (x + 0.5 - w / 2) / (w / 2), ny = (y + 0.5 - h * 0.45) / (h * 0.6);
        const d = nx * nx + ny * ny;
        if (d > 1.05 && bayer(x, y) < Math.min(1, (d - 1.05) * 2)) {
          const c = get(p.b, x, y);
          if (c !== TRANSPARENT) px(p.b, x, y, darker(c, 1));
        }
      }
    bg = p.b;
    portraitCache.set(key, bg);
  }
  const out = o.out && o.out.w === w && o.out.h === h ? o.out : createBuffer(w, h);
  out.data.set(bg.data);
  const px0 = Math.round(w / 2 - PED_W / 2);
  const py0 = h - 21;
  if (o.selected) drawBeam(out, w / 2, py0 + 6, 34, 54, now, !!o.reducedMotion);
  drawPedestal(out, theme, px0, py0, o.dim ? 'dim' : o.selected ? 'selected' : rig ? 'occupied' : 'empty', o.reducedMotion ? 0 : now);
  if (rig) drawCharacter(out, rig, px0 + 8, py0 - 40, now, 1, o.dim ? 1 : 0);
  return out;
}

void L_ARCH;
