// Entry of the coming-soon page (its own chunk, loaded by main.tsx while `/` waits for REAL's auction and the
// mainnet game to open): a one-screen document in the game's pixel kit (Castle Dungeon: gold buttons like the
// coin). When the countdown runs out the page tears itself down and hands the document to the game (`onLive`).
// QA hooks, with ?mock=1 only (src/net/index.ts): &launch=soon, &startin=3 (goes live 3 s in), &notoken=1.

import { render } from 'preact';
import './launch.css';
import '../beta.css';
import type { GameClient, PublicConfig } from '../../../shared/protocol.ts';
import { applyTheme } from '../ui/theme.ts';
import { LaunchPage } from './LaunchPage.tsx';

/** The UI pixel of the kit's 9-slice buttons: whole device pixels, 1 CSS px, 2 on very wide screens. */
export function launchUpx(w: number, h: number, dpr: number): number {
  const want = w >= 1800 && h >= 900 ? 2 : 1;
  return Math.max(1, Math.round(want * dpr)) / dpr;
}

function applyScale(): () => void {
  const set = () => {
    const root = document.documentElement.style;
    root.setProperty('--upx', launchUpx(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1) + 'px');
    root.setProperty('--px', (window.innerWidth >= 1800 ? 4 : 3) + 'px');
  };
  set();
  window.addEventListener('resize', set);
  return () => window.removeEventListener('resize', set);
}

export function start(root: HTMLElement, client: GameClient, config: PublicConfig, onLive: () => void): void {
  const html = document.documentElement;
  html.classList.add('ln-doc');
  applyTheme('castle');
  const unscale = applyScale();
  const meta = document.querySelector('meta[name="description"]');
  const description = meta?.getAttribute('content');
  const title = document.title;
  meta?.setAttribute('content', 'Realsies: an 8-bit chat game where you talk to a stranger for two minutes, then call it. Real human, or AI? The game and $REAL go live soon.');
  let handed = false;
  const live = () => {
    if (handed) return;
    handed = true;
    render(null, root);
    html.classList.remove('ln-doc');
    unscale();
    document.title = title;
    if (meta && description != null) meta.setAttribute('content', description);
    onLive();
  };
  render(<LaunchPage client={client} config={config} onLive={live} />, root);
}
