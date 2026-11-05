// Title cards: plain black, and a line typed on in big white pixel text on black with a terminal
// block cursor (solid while typing, blinking before and after).

import { type Rgba, PAL } from '../art.ts';
import { fillOut, rectOut, OUT_W, OUT_H } from '../engine/camera.ts';
import { drawCentered, advanceTo, measure } from '../engine/font.ts';
import { typedCount, lineShown, lineTimes, type Line } from '../engine/timeline.ts';

export function blackCard(out: Rgba): void {
  fillOut(out, 'pure-black');
}

/** `line` typed on at font scale `k`; `shotStart` paces the cursor's blink before the typing. */
export function typedCard(out: Rgba, t: number, line: Line, shotStart: number, k = 10): void {
  fillOut(out, 'pure-black');
  const l = line;
  const text = lineShown(l);
  const y = OUT_H / 2 - (7 * k) / 2;
  const n = typedCount(l, t);
  if (t >= l.at) {
    const x = drawCentered(out, text, OUT_W / 2, y, { color: PAL.white, scale: k }, n);
    // block cursor: solid while typing, blinking once done
    const done = t > lineTimes(l).end;
    const on = !done || Math.floor((t - lineTimes(l).end) / 0.4) % 2 === 1;
    if (on) rectOut(out, x + (advanceTo(text, n) + (n ? 1 : 0)) * k, y, 4 * k, 7 * k, PAL.white);
  } else if (Math.floor((t - shotStart) / 0.4) % 2 === 1) {
    // before typing: just the blinking cursor where the line will start
    const x = Math.round((OUT_W / 2 - (measure(text) * k) / 2) / k) * k;
    rectOut(out, x, y, 4 * k, 7 * k, PAL.white);
  }
}
