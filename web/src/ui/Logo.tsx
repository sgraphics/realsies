// The REALSIES logo (curved-bottom variant from the art engine) on its own small canvas, animated by
// the shared ticker, scaled by a whole number of device pixels closest to the requested CSS height.

import { useEffect, useRef } from 'preact/hooks';
import { createBuffer } from '../../../art/src/core/buffer.ts';
import { drawLogo, LOGO_W, LOGO_H } from '../../../art/src/themes/logo.ts';
import { addTicker, prefersReducedMotion } from '../../../art/src/browser/index.ts';

export function Logo(p: { height: number; class?: string; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const buf = createBuffer(LOGO_W, LOGO_H);
    const reduced = prefersReducedMotion();
    let last = -1;
    const draw = (now: number) => {
      const t = reduced ? 0 : Math.floor(now / 70) * 70;
      if (t === last) return;
      last = t;
      buf.data.fill(0);
      drawLogo(buf, 0, 0, t, 1, reduced);
      ctx.clearRect(0, 0, LOGO_W, LOGO_H);
      ctx.putImageData(new ImageData(buf.data as unknown as Uint8ClampedArray<ArrayBuffer>, LOGO_W, LOGO_H), 0, 0);
    };
    draw(Date.now());
    if (reduced) return;
    return addTicker(draw);
  }, []);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const k = Math.max(1, Math.round((p.height * dpr) / LOGO_H));
  return (
    <canvas
      ref={ref}
      class={'px-logo ' + (p.class ?? '')}
      width={LOGO_W}
      height={LOGO_H}
      role="img"
      aria-label={p.title ?? 'Realsies'}
      style={{ width: (LOGO_W * k) / dpr + 'px', height: (LOGO_H * k) / dpr + 'px' }}
    />
  );
}
