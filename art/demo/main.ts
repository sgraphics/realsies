// Art demo (npm run demo): the lobby composition per theme with ten idling characters.
// Buttons: theme, new faces, talk, look at the bubbles, react, reduced motion, chat/call scenes.

import { THEMES, THEME_NAMES, type ThemeId } from '../../shared/protocol.ts';
import type { SceneSeat, AnyLayout } from '../src/scene/types.ts';
import { chooseScale, layoutLobby, layoutChat, layoutCall, SceneRenderer } from '../src/scene/index.ts';
import { Rig, describeLook } from '../src/rig/rig.ts';
import { randomSeed } from '../src/core/rng.ts';
import { addTicker } from '../src/browser/index.ts';

const canvas = document.getElementById('world') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const bar = document.getElementById('bar')!;
const info = document.getElementById('info')!;

let theme: ThemeId = 'castle';
let kind: 'lobby' | 'chat' | 'call' = 'lobby';
let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let rigs: Rig[] = [];
let selected = -1;
let layout: AnyLayout;
let renderer: SceneRenderer;

function newFaces(): void {
  rigs = Array.from({ length: 10 }, () => new Rig(randomSeed(), { reducedMotion: reduced }));
  info.textContent = 'seat 0: ' + describeLook(rigs[0].look);
}

function relayout(): void {
  const s = chooseScale(innerWidth, innerHeight, devicePixelRatio || 1);
  const o = { cssPx: s.cssPx, orientation: s.orientation };
  layout = kind === 'lobby' ? layoutLobby(s.w, s.h, 10, o) : kind === 'chat' ? layoutChat(s.w, s.h, o) : layoutCall(s.w, s.h, o);
  if (!renderer) renderer = new SceneRenderer(theme, layout);
  renderer.setTheme(theme);
  renderer.setLayout(layout);
  canvas.width = layout.w;
  canvas.height = layout.h;
  canvas.style.width = layout.w * s.cssPx + 'px';
  canvas.style.height = layout.h * s.cssPx + 'px';
}

function button(label: string, fn: () => void, on?: () => boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => {
    fn();
    refresh();
  };
  (b as HTMLButtonElement & { on?: () => boolean }).on = on;
  bar.appendChild(b);
  return b;
}
function refresh(): void {
  for (const b of bar.querySelectorAll('button')) {
    const on = (b as HTMLButtonElement & { on?: () => boolean }).on;
    b.classList.toggle('on', !!on?.());
  }
}

for (const t of THEMES) button(THEME_NAMES[t], () => { theme = t; renderer.setTheme(t); }, () => theme === t);
button('Lobby', () => { kind = 'lobby'; relayout(); }, () => kind === 'lobby');
button('Chat', () => { kind = 'chat'; relayout(); }, () => kind === 'chat');
button('Call', () => { kind = 'call'; relayout(); }, () => kind === 'call');
button('New faces', newFaces);
button('Talk', () => rigs.forEach((r) => r.setTalking(!r.isTalking)), () => !!rigs[0]?.isTalking);
button('Look right', () => rigs.forEach((r, i) => r.lookToward(i % 2 ? 1 : -1)));
button('React', () => rigs.forEach((r, i) => r.react((['nod', 'wave', 'jump', 'shrug'] as const)[i % 4])));
button('Select', () => { selected = (selected + 2) % 11 - 1; });
button('Reduced motion', () => { reduced = !reduced; rigs.forEach((r) => r.setReducedMotion(reduced)); }, () => reduced);

newFaces();
relayout();
refresh();
addEventListener('resize', relayout);

let last = 0;
let image: ImageData | null = null;
const times: number[] = [];
addTicker((now) => {
  if (now - last < 60) return;
  last = now;
  const t0 = performance.now();
  const seats: SceneSeat[] = rigs.map((rig, i) => ({ rig, look: i === selected ? 'selected' : i === 9 ? 'dim' : 'idle' }));
  const out = renderer.render({ now, reducedMotion: reduced, seats, partner: rigs[0], fuse: ((now / 1000) % 120) / 120 });
  if (!image || image.data !== out.data || image.width !== out.w) image = new ImageData(out.data as unknown as Uint8ClampedArray<ArrayBuffer>, out.w, out.h);
  ctx.putImageData(image, 0, 0);
  times.push(performance.now() - t0);
  if (times.length === 60) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    document.title = `Realsies art demo · ${avg.toFixed(2)} ms/frame`;
    times.length = 0;
  }
});
