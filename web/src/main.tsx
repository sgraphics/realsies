import { render } from 'preact';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import './styles.css';
import './kit.css';
import './screens.css';
import { App } from './app.tsx';
import { createClient } from './net/index.ts';
import { createStore } from './state/store.ts';
import { installKeyboardInset } from './world/viewport.ts';
import { applyUiScale } from './ui/theme.ts';
import { chooseScale } from '../../art/src/scene/types.ts';

const store = createStore(createClient());
if (/[?&]qa=|[?&]as=/.test(location.search)) document.documentElement.classList.add('qa');
installKeyboardInset();
const ui = () => {
  const s = chooseScale(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  document.documentElement.style.setProperty('--px', s.cssPx + 'px');
  applyUiScale(s.scale, window.devicePixelRatio || 1);
};
ui();
window.addEventListener('resize', ui);

render(<App store={store} />, document.getElementById('app')!);

// handy in the console
(window as unknown as { realsies: unknown }).realsies = { store };
