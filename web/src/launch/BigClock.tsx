// The launch countdown in the chunky numerals of the game's 3, 2, 1, CHAT! (the art engine's big glyphs): each
// digit in a fixed cell so nothing shifts as it ticks, groups of two with their unit under them, on narrow screens
// two rows of two groups, scaled by a whole number of device pixels to the room it has. At zero it is the game's
// own CHAT!, the moment every chat starts with.

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { bigText, bigTextSize, countdownSprite, countdownStyle, CD_GO, type GlyphStyle } from '../../../art/src/ui/countdown.ts';
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

/** Two rows of two groups when there are days and the box is narrow (phones held upright). */
export function clockRows(groups: number, width: number): 1 | 2 {
  return groups === 4 && width > 0 && width < 520 ? 2 : 1;
}

export interface BigClockProps {
  ms: number;
  tone: ClockTone;
  /** what it counts to, for screen readers: "The game and REAL go live in" */
  label: string;
  /** at most this many CSS px per sprite pixel */
  maxCss: number;
  /** the digits (all rows, without the unit labels) at most this tall, in CSS px */
  maxHeight: number;
  /** zero: the game's CHAT! instead of the digits */
  go?: boolean;
}

export function BigClock(p: BigClockProps) {
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
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const box = w || 300;

  if (p.go) {
    const kW = Math.floor((box * dpr) / CD_GO.w);
    const kH = Math.floor((p.maxHeight * dpr) / CD_GO.h);
    const k = Math.max(1, Math.min(kW, kH, Math.round(p.maxCss * 1.25 * dpr)));
    const css = k / dpr;
    return (
      <div ref={ref} class="ln-clock">
        <img class="ln-go" src={toDataURL(countdownSprite('space', 'go'), 'launch-go')} alt="CHAT!" width={CD_GO.w * css} height={CD_GO.h * css} style={{ width: CD_GO.w * css + 'px', height: CD_GO.h * css + 'px' }} />
      </div>
    );
  }

  const groups = countdownGroups(countdownParts(p.ms)).map((g) => ({ ...g, text: String(g.v).padStart(2, '0') }));
  const rows = clockRows(groups.length, w) === 2 ? [groups.slice(0, 2), groups.slice(2)] : [groups];
  const rowDigits = Math.max(...rows.map((r) => r.reduce((a, g) => a + g.text.length, 0)));
  const rowGroups = Math.max(...rows.map((r) => r.length));
  const kW = clockScale(box, dpr, rowDigits, rowGroups, p.maxCss);
  const kH = Math.max(1, Math.floor((p.maxHeight / rows.length) * dpr / CELL.h));
  const k = Math.max(1, Math.min(kW, kH));
  const css = k / dpr;
  const labelPx = Math.max(9, Math.min(18, Math.round(css * 4.5)));
  return (
    <div ref={ref} class="ln-clock" role="timer" aria-label={`${p.label} ${spokenLeft(p.ms)}`}>
      {rows.map((row, ri) => (
        <div key={ri} class="ln-clock-row" style={{ gap: GROUP_GAP * css + 'px' }} aria-hidden="true">
          {row.map((g) => (
            <div key={g.long} class="ln-clock-g">
              {/* the seconds tick: a fresh element each second replays its bump */}
              <span key={g.long === 'seconds' ? 's' + g.text : g.long} class={'ln-clock-digits' + (g.long === 'seconds' ? ' tick' : '')}>
                {[...g.text].map((d, i) => (
                  <img key={i} class="ln-digit" src={digitUrl(d, p.tone)} alt="" width={CELL.w * css} height={CELL.h * css} style={{ width: CELL.w * css + 'px', height: CELL.h * css + 'px' }} />
                ))}
              </span>
              <span class="ln-clock-l" style={{ fontSize: labelPx + 'px' }}>{g.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
