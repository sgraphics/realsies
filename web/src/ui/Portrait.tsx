// A character on its pedestal over a bit of themed backdrop, animated (seat dialog, call screen).

import { useEffect, useRef } from 'preact/hooks';
import type { ThemeId } from '../../../shared/protocol.ts';
import { renderPortrait } from '../../../art/src/scene/index.ts';
import { addTicker, prefersReducedMotion } from '../../../art/src/browser/index.ts';
import type { Rig } from '../../../art/src/rig/rig.ts';

export function Portrait(p: { theme: ThemeId; rig: Rig | null; height: number; selected?: boolean; dim?: boolean; class?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 64, H = 76;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const reduced = prefersReducedMotion();
    let last = 0;
    const draw = (now: number) => {
      if (now - last < 60) return;
      last = now;
      const img = renderPortrait(p.theme, p.rig, now, W, H, { selected: p.selected, dim: p.dim, reducedMotion: reduced });
      if (c.width !== img.w) c.width = img.w;
      if (c.height !== img.h) c.height = img.h;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data) as unknown as Uint8ClampedArray<ArrayBuffer>, img.w, img.h), 0, 0);
    };
    draw(Date.now());
    return addTicker(draw);
  }, [p.theme, p.rig, p.selected, p.dim]);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const k = Math.max(2, Math.round((p.height * dpr) / H));
  return <canvas ref={ref} class={'pixel ' + (p.class ?? '')} width={W} height={H} style={{ width: (W * k) / dpr + 'px', height: (H * k) / dpr + 'px', display: 'block' }} aria-hidden="true" />;
}
