// Apply a theme kit to the DOM: CSS colours plus 9-slice sprites as border-image data URLs.
// --upx is the UI pixel (an integer number of device pixels), so sprite borders stay crisp.

import type { ThemeId } from '../../../shared/protocol.ts';
import type { Rgba } from '../../../art/src/core/buffer.ts';
import { getThemeKit, type NineSlice } from '../../../art/src/themes/index.ts';
import { toDataURL } from '../../../art/src/browser/index.ts';

function hexAt(img: Rgba, x: number, y: number): string {
  const i = (Math.min(img.h - 1, Math.max(0, y)) * img.w + Math.min(img.w - 1, Math.max(0, x))) * 4;
  const d = img.data;
  return '#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
}
const centre = (n: NineSlice) => hexAt(n.img, n.img.w >> 1, n.img.h >> 1);

let current: ThemeId | null = null;

export function applyTheme(id: ThemeId): void {
  if (current === id) return;
  current = id;
  const kit = getThemeKit(id);
  const s = document.documentElement.style;
  const c = kit.colors;
  const set = (k: string, v: string) => s.setProperty(k, v);
  set('--ink', c.panelText);
  set('--ink-dim', c.textDim);
  set('--world-ink', c.text);
  set('--accent', c.accent);
  set('--good', c.good);
  set('--bad', c.bad);
  set('--edge', c.textShadow);
  set('--plate-ink', c.plateText);
  set('--label-ink', (c as { labelText?: string }).labelText ?? '#ffffff');
  set('--panel', centre(kit.ui.panel));
  set('--panel-2', hexAt(kit.ui.button.up.img, kit.ui.button.up.img.w >> 1, kit.ui.button.up.img.h >> 1));
  set('--bubble-them', centre(kit.ui.bubbleThem));
  set('--bubble-them-ink', c.bubbleThemText);
  set('--bubble-me', centre(kit.ui.bubbleMe));
  set('--bubble-me-ink', c.bubbleMeText);
  set('--hud-bg', c.bg);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.bg);

  const nine = (name: string, n: NineSlice) => {
    set(`--img-${name}`, `url("${toDataURL(n.img, `${id}:${name}`)}")`);
    set(`--slice-${name}`, String(n.slice));
    set(`--pad-${name}`, String(n.pad));
  };
  const u = kit.ui;
  nine('panel', u.panel);
  nine('btn', u.button.up);
  nine('btn-down', u.button.down);
  nine('btn-off', u.button.disabled);
  nine('btn-pri', u.buttonPrimary.up);
  nine('btn-pri-down', u.buttonPrimary.down);
  nine('btn-yes', u.buttonYes.up);
  nine('btn-yes-down', u.buttonYes.down);
  nine('btn-no', u.buttonNo.up);
  nine('btn-no-down', u.buttonNo.down);
  nine('bubble-them', u.bubbleThem);
  nine('bubble-me', u.bubbleMe);
  nine('plate', u.plate);
  nine('tab', u.tab.up);
  nine('tab-on', u.tab.active);
  set('--img-tail-them', `url("${toDataURL(u.tailThem, `${id}:tail-them`)}")`);
  set('--img-tail-me', `url("${toDataURL(u.tailMe, `${id}:tail-me`)}")`);
  set('--tail-w', String(u.tailThem.w));
  set('--tail-h', String(u.tailThem.h));
  document.documentElement.classList.add('kit');
}

/**
 * UI pixel for the 9-slice sprites of panels, buttons and bubbles: half the world pixel, between 1
 * and 3 CSS px, always whole device pixels (big world scales must not make panel borders chunky).
 * The HUD uses its own: 1 CSS px per sprite pixel, 2 on very wide screens.
 */
export function applyUiScale(cssPx: number, dpr: number): void {
  const want = Math.min(3, Math.max(1, cssPx * 0.5));
  const dev = Math.max(1, Math.round(want * dpr));
  const root = document.documentElement.style;
  root.setProperty('--upx', dev / dpr + 'px');
  const hud = Math.max(1, Math.round((window.innerWidth >= 1800 ? 2 : 1) * dpr));
  root.setProperty('--hud-upx', hud / dpr + 'px');
}
