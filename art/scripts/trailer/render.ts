// Frame renderer: time in, a 1920x1080 RGBA frame out. Dispatches on the storyboard's shot kind and
// draws the film-style subtitles (white pixel text, dark outline, typed on) over the interview.

import type { Rgba } from '../../src/core/buffer.ts';
import { PAL } from '../../src/core/palette.ts';
import { Interview, type VoiceEnvelopes } from './interview.ts';
import { renderMontage } from './montage.ts';
import { renderEndCard } from './endcard.ts';
import { fillOut, fadeBuffer, newFrame, rectOut, letterbox, OUT_W, OUT_H } from './camera.ts';
import { drawCentered, advanceTo, measure } from './font.ts';
import { drawChat } from './chat.ts';
import { SHOTS, LINES, shotAt, typedCount, lineShown, lineTimes } from './storyboard.ts';

export class Renderer {
  private interview = new Interview();
  private out = newFrame();
  constructor(private voice?: VoiceEnvelopes) {}

  frame(t: number): Rgba {
    const out = this.out;
    const shot = shotAt(t);
    switch (shot.kind) {
      case 'black':
        fillOut(out, 'pure-black');
        break;
      case 'set':
        this.interview.render(out, shot, t, this.voice);
        drawChat(out, t);
        letterbox(out);
        break;
      case 'card':
        this.card(out, t);
        break;
      case 'end':
        renderEndCard(out, t);
        break;
      default:
        renderMontage(out, shot, t);
    }
    if (shot.fadeOut && t > shot.end - shot.fadeOut) fadeBuffer(out, Math.ceil(((t - (shot.end - shot.fadeOut)) / shot.fadeOut) * 6));
    return out;
  }

  private card(out: Rgba, t: number): void {
    fillOut(out, 'pure-black');
    const l = LINES.find((x) => x.id === 'can-you-tell')!;
    const k = 10;
    const text = lineShown(l);
    const y = OUT_H / 2 - (7 * k) / 2;
    const n = typedCount(l, t);
    if (t >= l.at) {
      const x = drawCentered(out, text, OUT_W / 2, y, { color: PAL.white, scale: k }, n);
      // block cursor: solid while typing, blinking once done
      const done = t > lineTimes(l).end;
      const on = !done || Math.floor((t - lineTimes(l).end) / 0.4) % 2 === 1;
      if (on) rectOut(out, x + (advanceTo(text, n) + (n ? 1 : 0)) * k, y, 4 * k, 7 * k, PAL.white);
    } else if (Math.floor((t - shotAt(t).start) / 0.4) % 2 === 1) {
      // before typing: just the blinking cursor where the line will start
      const x = Math.round((OUT_W / 2 - (measure(text) * k) / 2) / k) * k;
      rectOut(out, x, y, 4 * k, 7 * k, PAL.white);
    }
  }
}

export { SHOTS };
