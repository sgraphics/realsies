import { useEffect, useRef, useState } from 'preact/hooks';
import { Rig } from '../../../art/src/rig/rig.ts';
import { prefersReducedMotion } from '../../../art/src/browser/index.ts';

/** Current time, re-rendering every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Stable Rig instances keyed by seed (kept across renders, rebuilt when the seed changes). */
export function useRigs(seeds: (string | null | undefined)[]): (Rig | null)[] {
  const cache = useRef(new Map<string, Rig>());
  const out = seeds.map((s) => {
    if (!s) return null;
    let r = cache.current.get(s);
    if (!r) {
      r = new Rig(s, { reducedMotion: prefersReducedMotion() });
      cache.current.set(s, r);
    }
    return r;
  });
  // forget rigs no longer shown
  if (cache.current.size > seeds.length * 2 + 8) {
    const keep = new Set(seeds.filter(Boolean) as string[]);
    for (const k of [...cache.current.keys()]) if (!keep.has(k)) cache.current.delete(k);
  }
  return out;
}

export function useRig(seed: string | null | undefined): Rig | null {
  return useRigs([seed])[0];
}

/** Escape closes. */
export function useEscape(fn: () => void): void {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fn();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fn]);
}
