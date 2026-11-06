// The launch countdown in the chunky numerals of the game's 3, 2, 1, CHAT! (the art engine's big glyphs):
// each digit in a fixed cell so nothing shifts as it ticks, groups of two with their unit under them, scaled
// by a whole number of device pixels to fit the card.

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { bigText, bigTextSize, countdownStyle, type GlyphStyle } from '../../../art/src/ui/countdown.ts';
import { blit, createBuffer } from '../../../art/src/core/buffer.ts';
import { toDataURL } from '../../../art/src/browser/index.ts';
import { countdownGroups, countdownParts, spokenLeft } from './phase.ts';

export type ClockTone = 'ice' | 'gold';

const TONES: Record<ClockTone, () => GlyphStyle> = {
  ice: () => countdownStyle('space').digit,
  gold: () => countdownStyle('castle').digit,
};

/** One digit's cell in sprite pixels: the widest numeral (a "1" is centred in it). */
export const CELL = bigTextSize('0');
/** Sprite pixels between two groups. */
export const GROUP_GAP = 11;

const URLS = new Map<string, string>();
function digitUrl(d: string, tone: ClockTone): string {
  const key = `launch-digit:${tone}:${d}`;
  let u = URLS.get(key);
  if (!u) {
    const glyph = bigText(d, TONES[tone]());
    const cell = createBuffer(CELL.w, CELL.h);
    blit(cell, glyph, Math.floor((CELL.w - glyph.w) / 2), 0);
    u = toDataURL(cell, key);
    URLS.set(key, u);
  }
  return u;
}

/** Device pixels per sprite pixel so `digits` digits in `groups` groups fit `availCss`; at most `maxCss` CSS px each. */
export function clockScale(availCss: number, dpr: number, digits: number, groups: number, maxCss: number): number {
  const artW = digits * CELL.w + (groups - 1) * GROUP_GAP;
  const k = Math.floor((Math.max(0, availCss) * dpr) / artW);
  return Math.max(1, Math.min(k, Math.round(maxCss * dpr)));
}

export function BigClock(p: { ms: number; tone: ClockTone; label: string; maxCss?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => setW(el.clientWidth);
    on();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(on) : null;
    ro?.observe(el);
    window.addEventListener('resize', on);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', on);
    };
  }, []);
  const groups = countdownGroups(countdownParts(p.ms)).map((g) => ({ ...g, text: String(g.v).padStart(2, '0') }));
  const digits = groups.reduce((a, g) => a + g.text.length, 0);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  // a phone held sideways has no height to spare: one CSS px per sprite pixel there
  const short = typeof window !== 'undefined' && window.innerHeight < 520;
  const k = clockScale(w || 300, dpr, digits, groups.length, short ? 1 : p.maxCss ?? 2);
  const css = k / dpr;
  return (
    <div ref={ref} class="ln-clock" role="timer" aria-label={`${p.label} ${spokenLeft(p.ms)}`}>
      <div class="ln-clock-row" style={{ gap: GROUP_GAP * css + 'px' }} aria-hidden="true">
        {groups.map((g) => (
          <div key={g.long} class="ln-clock-g">
            <span class="ln-clock-digits">
              {[...g.text].map((d, i) => (
                <img key={i} class="ln-digit" src={digitUrl(d, p.tone)} alt="" width={CELL.w * css} height={CELL.h * css} style={{ width: CELL.w * css + 'px', height: CELL.h * css + 'px' }} />
              ))}
            </span>
            <span class="ln-clock-l" style={{ fontSize: Math.max(9, Math.min(16, Math.round(css * 6))) + 'px' }}>{g.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
