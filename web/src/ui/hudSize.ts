// The HUD's height in CSS px, shared between the HUD (which measures itself) and the World (which
// lays the room out under it). A tiny observable; an estimate from the window size stands in until
// the first measurement so the first frame does not jump.

import { useEffect, useState } from 'preact/hooks';

let current = 0;
let measured = false;
const subs = new Set<(h: number) => void>();

/** Expected HUD height before it is measured (mirrors the breakpoints in hud.css). */
export function estimateHud(w: number, h: number): number {
  if (w >= 700 && h <= 520) return 49;
  if (w >= 1000) return w >= 1800 ? 65 : 55;
  return w >= 600 ? 102 : 89;
}

export function hudHeight(): number {
  if (measured) return current;
  return typeof window === 'undefined' ? 0 : estimateHud(window.innerWidth, window.innerHeight);
}

export function setHudHeight(h: number): void {
  const v = Math.round(h);
  measured = true;
  if (v === current) return;
  current = v;
  document.documentElement.style.setProperty('--hud-h', v + 'px');
  for (const f of [...subs]) f(v);
}

/** Re-render when the HUD height changes. */
export function useHudHeight(): number {
  const [h, setH] = useState(hudHeight);
  useEffect(() => {
    subs.add(setH);
    setH(hudHeight());
    return () => {
      subs.delete(setH);
    };
  }, []);
  return h;
}
