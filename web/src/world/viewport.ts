// Viewport tracking: integer world scale under the HUD, composition, on-screen keyboard inset.

import { useEffect, useState } from 'preact/hooks';
import type { ScaleInfo } from '../../../art/src/scene/types.ts';
import { chooseScale } from '../../../art/src/scene/layout.ts';
import { useHudHeight } from '../ui/hudSize.ts';

export type ScaleKind = 'lobby' | 'hall';

function measure(hud: number, kind: ScaleKind): ScaleInfo {
  return chooseScale(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, hud, kind);
}

function inputFocused(): boolean {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
}

const same = (a: ScaleInfo, b: ScaleInfo) => a.scale === b.scale && a.w === b.w && a.h === b.h && a.cssPx === b.cssPx && a.orientation === b.orientation && a.top === b.top;

/**
 * Scale info for the box under the HUD. Ignores height-only shrinks while typing (phone
 * keyboards), so the world does not jump when the keyboard opens.
 */
export function useScale(kind: ScaleKind = 'lobby'): ScaleInfo {
  const hud = useHudHeight();
  const [s, setS] = useState(() => measure(hud, kind));
  useEffect(() => {
    const n = measure(hud, kind);
    setS((o) => (same(o, n) ? o : n));
  }, [hud, kind]);
  useEffect(() => {
    let lastW = window.innerWidth;
    const on = () => {
      const w = window.innerWidth;
      if (w === lastW && inputFocused()) return; // keyboard opened or closed: keep the world as is
      lastW = w;
      const n = measure(hud, kind);
      setS((o) => (same(o, n) ? o : n));
    };
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, [hud, kind]);
  return s;
}

/** Keeps --kb (keyboard inset in CSS px) and --vvh (visible height) up to date on the root element. */
export function installKeyboardInset(): () => void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const forced = new URLSearchParams(location.search).get('kb'); // QA: pretend a phone keyboard of this height is open
  const update = () => {
    const vh = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    const kb = forced ? Number(forced) || 0 : Math.max(0, Math.round(window.innerHeight - vh - top));
    root.style.setProperty('--kb', kb + 'px');
    root.style.setProperty('--vvh', Math.round(vh - (forced ? kb : 0)) + 'px');
    root.classList.toggle('kb-open', kb > 0);
    if (kb > 0 && !forced) window.scrollTo(0, 0);
  };
  update();
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  return () => {
    vv?.removeEventListener('resize', update);
    vv?.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
  };
}
