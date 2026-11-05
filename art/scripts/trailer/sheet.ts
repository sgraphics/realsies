// keyframes.png: one frame per shot (at its storyboard key time), box-downscaled to 480x270, with
// the shot number, timecode and title under each.

import { type Rgba, createBuffer } from '../../src/core/buffer.ts';
import { PAL } from '../../src/core/palette.ts';
import { Renderer } from './render.ts';
import { rectOut, fillOut } from './camera.ts';
import { drawString, measure } from './font.ts';
import { SHOTS, TITLE, DURATION } from './storyboard.ts';
import { tc } from './scriptmd.ts';

const TW = 480, TH = 270, COLS = 4, M = 16, LAB = 34, HEAD = 64;

function thumb(src: Rgba): Rgba {
  const out = createBuffer(TW, TH);
  const k = src.w / TW;
  for (let y = 0; y < TH; y++)
    for (let x = 0; x < TW; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = 0; yy < k; yy++)
        for (let xx = 0; xx < k; xx++) {
          const i = ((y * k + yy) * src.w + x * k + xx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          n++;
        }
      const o = (y * TW + x) * 4;
      out.data[o] = r / n;
      out.data[o + 1] = g / n;
      out.data[o + 2] = b / n;
      out.data[o + 3] = 255;
    }
  return out;
}

export function keyframeSheet(r = new Renderer()): Rgba {
  const rows = Math.ceil(SHOTS.length / COLS);
  const W = M + COLS * (TW + M), H = HEAD + rows * (TH + LAB + M) + M;
  const sheet = createBuffer(W, H);
  fillOut(sheet, PAL.navyDark);
  drawString(sheet, `${TITLE}  -  ${DURATION.toFixed(1)} s, 1920x1080, 24 fps  -  one frame per shot`, M, 20, { color: PAL.white, scale: 3 });
  SHOTS.forEach((s, i) => {
    const x = M + (i % COLS) * (TW + M), y = HEAD + Math.floor(i / COLS) * (TH + LAB + M);
    const f = r.frame(s.key);
    const t = thumb(f);
    rectOut(sheet, x - 2, y - 2, TW + 4, TH + 4, PAL.black);
    for (let yy = 0; yy < TH; yy++) sheet.data.set(t.data.subarray(yy * TW * 4, (yy + 1) * TW * 4), ((y + yy) * W + x) * 4);
    const lab = `${String(i + 1).padStart(2, '0')}  ${tc(s.start)}-${tc(s.end)}`;
    drawString(sheet, lab, x, y + TH + 8, { color: PAL.gold, scale: 2 });
    drawString(sheet, s.title, x + measure(lab) * 2 + 14, y + TH + 8, { color: PAL.greyLight, scale: 2 });
  });
  return sheet;
}
