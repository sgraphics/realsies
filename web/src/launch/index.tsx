// Entry of the launch page (its own chunk, loaded by main.tsx when the relay sends PublicConfig.launch): a
// scrolling document in the game's pixel kit (Castle Dungeon: gold buttons like the coin), the page scale,
// the title, then the page. QA hooks, with ?mock=1 only:
//   &launch=soon|auction|finalizing   the phase (src/net/index.ts)
//   &opens=5                          the coin is set 5 s in: "The game is open" (the page re-reads every second)
//   &qa=top|steps|bottom              scroll there once the layout settles (top: no scroll)

import { render } from 'preact';
import './launch.css';
import type { GameClient, PublicConfig } from '../../../shared/protocol.ts';
import { applyTheme } from '../ui/theme.ts';
import { inMock } from '../agents/route.ts';
import { LaunchPage } from './LaunchPage.tsx';

/** The UI pixel of the kit's 9-slice panels and buttons: whole device pixels, 1 CSS px, 2 on very wide screens. */
export function launchUpx(w: number, h: number, dpr: number): number {
  const want = w >= 1800 && h >= 900 ? 2 : 1;
  return Math.max(1, Math.round(want * dpr)) / dpr;
}

function applyScale(): void {
  const set = () => {
    const root = document.documentElement.style;
    root.setProperty('--upx', launchUpx(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1) + 'px');
    root.setProperty('--px', (window.innerWidth >= 1800 ? 4 : 3) + 'px');
  };
  set();
  window.addEventListener('resize', set);
}

export function start(root: HTMLElement, client: GameClient, config: PublicConfig): void {
  document.documentElement.classList.add('ln-doc');
  applyTheme('castle');
  applyScale();
  document.querySelector('meta[name="description"]')?.setAttribute(
    'content',
    'Realsies: an 8-bit chat game where you talk to a stranger for two minutes, then call it. Real human, or AI? REAL launches on meme.cooking.',
  );
  const q = new URLSearchParams(location.search);
  const mock = inMock(location.search);
  const pollMs = mock && q.get('opens') !== null ? 1000 : mock && Number(q.get('pollms')) > 0 ? Number(q.get('pollms')) : undefined;
  render(<LaunchPage client={client} config={config} pollMs={pollMs} />, root);
  const qa = mock ? q.get('qa') : null;
  if (qa === 'steps' || qa === 'bottom') {
    const go = () =>
      qa === 'steps' ? document.getElementById('ln-how')?.scrollIntoView({ block: 'start' }) : window.scrollTo(0, document.documentElement.scrollHeight);
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    const later = () => requestAnimationFrame(() => requestAnimationFrame(go));
    if (fonts?.ready) fonts.ready.then(later, later);
    else later();
  }
}
