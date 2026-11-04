// Viewport tracking: integer world scale, orientation, on-screen keyboard inset.

import { useEffect, useState } from 'preact/hooks';
import { chooseScale, type ScaleInfo } from '../../../art/src/scene/types.ts';

function measure(): ScaleInfo {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return chooseScale(w, h, window.devicePixelRatio || 1);
}

function inputFocused(): boolean {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
}

/** Scale info that ignores height-only shrinks while typing (phone keyboards), so the world does not jump. */
export function useScale(): ScaleInfo {
  const [s, setS] = useState(measure);
  useEffect(() => {
    let raf = 0;
    let lastW = window.innerWidth;
    const on = () => {
      const w = window.innerWidth;
      if (w === lastW && inputFocused()) return; // keyboard opened or closed: keep the world as is
      lastW = w;
      const n = measure();
      setS((o) => (o.scale === n.scale && o.w === n.w && o.h === n.h && o.cssPx === n.cssPx ? o : n));
    };
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
      cancelAnimationFrame(raf);
    };
  }, []);
  return s;
}

/** Keeps --kb (keyboard inset in CSS px) and --vvh (visible height) up to date on the root element. */
export function installKeyboardInset(): () => void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const update = () => {
    const vh = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    const kb = Math.max(0, Math.round(window.innerHeight - vh - top));
    root.style.setProperty('--kb', kb + 'px');
    root.style.setProperty('--vvh', Math.round(vh) + 'px');
    if (kb > 0) window.scrollTo(0, 0);
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
