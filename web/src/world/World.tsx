// The world: one full-window canvas drawn by the art engine at an integer scale, with a DOM
// overlay whose children are placed in game-pixel rects (text, buttons, inputs).

import type { ComponentChildren, CSSProperties } from 'preact';
import { createContext } from 'preact';
import { useContext, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { ThemeId } from '../../../shared/protocol.ts';
import type { AnyLayout, Rect, ScaleInfo, SceneSeat } from '../../../art/src/scene/types.ts';
import { layoutLobby, layoutChat, layoutCall, layoutHall, SceneRenderer } from '../../../art/src/scene/index.ts';
import type { Rig } from '../../../art/src/rig/rig.ts';
import { addTicker, prefersReducedMotion } from '../../../art/src/browser/index.ts';
import { useScale } from './viewport.ts';

export type SceneKind = 'lobby' | 'chat' | 'call' | 'hall';

export interface WorldCtx {
  layout: AnyLayout;
  scale: ScaleInfo;
  /** Absolute CSS box for a game-pixel rect. */
  box(r: Rect, extra?: CSSProperties): CSSProperties;
  px(n: number): number;
}

const Ctx = createContext<WorldCtx | null>(null);
export function useWorld(): WorldCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWorld outside <World>');
  return c;
}

export interface WorldProps {
  theme: ThemeId;
  kind: SceneKind;
  /** Lobby/hall seats (by slot index). */
  seats?: SceneSeat[];
  /** Number of hall pedestals. */
  hallSeats?: number;
  partner?: Rig | null;
  /** Chat fuse 1..0. */
  fuse?: number;
  children?: (ctx: WorldCtx) => ComponentChildren;
}

function makeLayout(kind: SceneKind, w: number, h: number, n: number): AnyLayout {
  switch (kind) {
    case 'lobby': return layoutLobby(w, h, 10);
    case 'chat': return layoutChat(w, h);
    case 'call': return layoutCall(w, h);
    case 'hall': return layoutHall(w, h, n);
  }
}

export function World(p: WorldProps) {
  const scale = useScale();
  const layout = useMemo(() => makeLayout(p.kind, scale.w, scale.h, p.hallSeats ?? 0), [p.kind, scale.w, scale.h, p.hallSeats]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mirror = useRef<HTMLImageElement>(null);
  const renderer = useRef<SceneRenderer | null>(null);
  const state = useRef({ seats: p.seats, partner: p.partner, fuse: p.fuse });
  state.current = { seats: p.seats, partner: p.partner, fuse: p.fuse };

  if (!renderer.current) renderer.current = new SceneRenderer(p.theme, layout);
  renderer.current.setTheme(p.theme);
  renderer.current.setLayout(layout);

  // layout effect: redraw in the same commit as the DOM overlay so text and canvas never disagree
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d', { alpha: false });
    if (!ctx) return;
    let image: ImageData | null = null;
    let last = 0;
    // QA screenshots (?qa=): headless Chrome does not always composite canvases, so mirror each frame into an <img>
    const qa = document.documentElement.classList.contains('qa');
    let reduced = prefersReducedMotion();
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onMq = () => { reduced = !!mq?.matches; };
    mq?.addEventListener('change', onMq);
    const draw = (now: number, force = false) => {
      if (!force && now - last < 60) return; // ~15 fps is plenty for 6 fps idles and prop loops
      last = now;
      const r = renderer.current!;
      const s = state.current;
      const out = r.render({ now, reducedMotion: reduced, seats: s.seats, partner: s.partner ?? null, fuse: s.fuse });
      if (c.width !== out.w || c.height !== out.h) {
        c.width = out.w;
        c.height = out.h;
        image = null;
      }
      if (!image || image.data !== out.data) image = new ImageData(out.data as unknown as Uint8ClampedArray<ArrayBuffer>, out.w, out.h);
      ctx.putImageData(image, 0, 0);
      if (qa && mirror.current) {
        mirror.current.src = c.toDataURL();
        const rl = (r as unknown as { layout: { w: number; h: number; seats?: { pedestal: { y: number } }[] } }).layout;
        c.dataset.drawn = `${out.w}x${out.h} renderer=${rl.w}x${rl.h} ped0=${rl.seats?.[0]?.pedestal.y}`;
      }
    };
    draw(Date.now(), true);
    const stop = addTicker(draw);
    return () => {
      stop();
      mq?.removeEventListener('change', onMq);
    };
  }, [layout, p.theme]);

  const ctx: WorldCtx = useMemo(() => {
    const k = scale.cssPx;
    return {
      layout,
      scale,
      px: (n: number) => n * k,
      box: (r: Rect, extra?: CSSProperties) => ({ position: 'absolute', left: r.x * k + 'px', top: r.y * k + 'px', width: r.w * k + 'px', height: r.h * k + 'px', ...extra }),
    };
  }, [layout, scale]);

  const cssW = layout.w * scale.cssPx;
  const cssH = layout.h * scale.cssPx;
  return (
    <Ctx.Provider value={ctx}>
      <div class={'world world-' + p.kind} style={{ '--px': scale.cssPx + 'px' } as CSSProperties} data-layout={`${layout.w}x${layout.h}@${scale.scale}/${scale.cssPx}`}>
        <canvas ref={canvas} class="world-canvas" width={layout.w} height={layout.h} style={{ width: cssW + 'px', height: cssH + 'px' }} aria-hidden="true" />
        {typeof document !== 'undefined' && document.documentElement.classList.contains('qa') && (
          <img ref={mirror} class="world-canvas" alt="" style={{ width: cssW + 'px', height: cssH + 'px' }} />
        )}
        <div class="world-overlay" style={{ width: cssW + 'px', height: cssH + 'px' }}>
          {p.children?.(ctx)}
        </div>
      </div>
    </Ctx.Provider>
  );
}
