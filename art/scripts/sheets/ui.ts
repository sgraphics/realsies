// UI sprite sheet: icons at 1x..6x on light and dark backgrounds; the countdown (VS doors, numerals,
// CHAT!, VS) per theme in a small landscape and portrait mock-up.
import type { SheetOut } from '../sheets.ts';
import { createBuffer, clear, blit, scaleUp, rect, type Rgba } from '../../src/core/buffer.ts';
import { PAL } from '../../src/core/palette.ts';
import { drawText } from '../../src/core/font.ts';
import { rngFrom, randomSeed } from '../../src/core/rng.ts';
import { Rig, CHAR_W, CHAR_H } from '../../src/rig/rig.ts';
import { icon, ICON_NAMES } from '../../src/ui/icons.ts';
import { countdownSprite, renderVsDoor } from '../../src/ui/countdown.ts';
import { THEMES } from '../../../shared/protocol.ts';

export async function sheetsUi(out: SheetOut): Promise<void> {
  const cell = 16;
  const img = createBuffer(ICON_NAMES.length * cell + 4, 2 * cell + 12);
  clear(img, PAL.navy);
  rect(img, 0, cell + 2, img.w, cell + 10, PAL.cream);
  ICON_NAMES.forEach((n, i) => {
    const ic = icon(n);
    const x = 2 + i * cell + ((cell - ic.w) >> 1);
    blit(img, ic, x, 2 + ((cell - ic.h) >> 1));
    blit(img, ic, x, cell + 4 + ((cell - ic.h) >> 1));
    drawText(img, n.slice(0, 4), 2 + i * cell, 2 * cell + 5, PAL.brown);
  });
  out('ui-icons', scaleUp(img, 5));
  sheetsCountdown(out);
}

/** One VS frame: doors, two characters, a sprite in the middle, VS at the bottom. */
function vsFrame(theme: (typeof THEMES)[number], w: number, h: number, what: '3' | '2' | '1' | 'go', me: Rig, them: Rig): Rgba {
  const f = createBuffer(w, h);
  const portrait = h > w;
  const cx = w / 2, cy = portrait ? h * 0.36 : h * 0.46;
  const slant = portrait ? 0.06 : 0.2;
  const o = { cx, cy, seamTop: cx + cy * slant, seamBottom: cx - (h - cy) * slant };
  blit(f, renderVsDoor(theme, 'me', w, h, o), 0, 0);
  blit(f, renderVsDoor(theme, 'them', w, h, o), 0, 0);
  const s = countdownSprite(theme, what);
  blit(f, s, Math.round(cx - s.w / 2), Math.round(cy - s.h / 2));
  const fy = h - CHAR_H - 6;
  blit(f, me.frame(0, { shadow: true }), 4, fy);
  blit(f, them.frame(0, { shadow: true }), w - CHAR_W - 4, fy);
  const vs = countdownSprite(theme, 'vs');
  blit(f, vs, Math.round(cx - vs.w / 2), h - vs.h - 2);
  return f;
}

function sheetsCountdown(out: SheetOut): void {
  const rng = rngFrom('countdown sheet');
  const me = new Rig(randomSeed(rng)), them = new Rig(randomSeed(rng));
  me.lookToward(1);
  them.lookToward(-1);
  const LW = 190, LH = 108, PW = 96, PH = 170, G = 4;
  for (const theme of THEMES) {
    const frames = (['3', '2', '1', 'go'] as const).map((w) => vsFrame(theme, LW, LH, w, me, them));
    const tall = vsFrame(theme, PW, PH, '2', me, them);
    const sheet = createBuffer(G + 2 * (LW + G) + PW + G, G + Math.max(2 * (LH + G), PH + G) + 8);
    clear(sheet, PAL.black);
    frames.forEach((fr, i) => blit(sheet, fr, G + (i % 2) * (LW + G), G + Math.floor(i / 2) * (LH + G)));
    blit(sheet, tall, G + 2 * (LW + G), G);
    drawText(sheet, theme, G, sheet.h - 7, PAL.greyLight);
    out('countdown-' + theme, scaleUp(sheet, 3));
  }
}
