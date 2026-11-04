// UI sprite sheet: icons at 1x..6x on light and dark backgrounds.
import type { SheetOut } from '../sheets.ts';
import { createBuffer, clear, blit, scaleUp, rect } from '../../src/core/buffer.ts';
import { PAL } from '../../src/core/palette.ts';
import { drawText } from '../../src/core/font.ts';
import { icon, ICON_NAMES } from '../../src/ui/icons.ts';

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
}
