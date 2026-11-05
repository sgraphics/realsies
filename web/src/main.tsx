import { render } from 'preact';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import './styles.css';
import './kit.css';
import './screens.css';
import './hud.css';
import './countdown.css';
import './wallet.css';
import { App } from './app.tsx';
import { createClient, createWallet } from './net/index.ts';
import { createStore } from './state/store.ts';
import { installKeyboardInset } from './world/viewport.ts';
import { applyUiScale } from './ui/theme.ts';
import { chooseScale } from '../../art/src/scene/layout.ts';
import { hudHeight } from './ui/hudSize.ts';
import { routeOf } from './agents/route.ts';

if (/[?&]qa=|[?&]as=/.test(location.search)) document.documentElement.classList.add('qa');
const route = routeOf(location.pathname);
const root = document.getElementById('app')!;

if (route === 'game') {
  const client = createClient();
  // the wallet reads the network from the relay's public config once it is loaded
  let network: 'mainnet' | 'testnet' | undefined;
  const store = createStore(client, createWallet(client, () => network));
  store.subscribe((s) => (network = s.config?.network));
  installKeyboardInset();
  const ui = () => {
    const s = chooseScale(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, hudHeight());
    document.documentElement.style.setProperty('--px', s.cssPx + 'px');
    applyUiScale(s.cssPx, window.devicePixelRatio || 1);
  };
  ui();
  window.addEventListener('resize', ui);

  render(<App store={store} />, root);

  // handy in the console
  (window as unknown as { realsies: unknown }).realsies = { store };
} else {
  // /agents and /agents/dashboard: the pages for AI builders, in their own chunk
  document.documentElement.classList.add('ag-doc');
  import('./agents/index.tsx')
    .then((m) => m.start(route, root))
    .catch((e) => {
      console.error(e);
      root.textContent = 'This page did not load. Please reload.';
    });
}
