// Theme registry. getThemeKit(id) is what the web app uses (name, CSS colours, UI sprites);
// getThemeDef(id) is the painter set the scene renderer uses.

import type { ThemeId } from '../../../shared/protocol.ts';
import type { ThemeColors, ThemeDef, UiKit } from './types.ts';
import { castle } from './castle.ts';
import { jungle } from './jungle.ts';
import { desert } from './desert.ts';
import { cave } from './cave.ts';
import { space } from './space.ts';

const DEFS: Partial<Record<ThemeId, ThemeDef>> = { castle, jungle, desert, cave, space };

export function registerTheme(def: ThemeDef): void {
  DEFS[def.id] = def;
}

export function getThemeDef(id: ThemeId): ThemeDef {
  return DEFS[id] ?? castle;
}

export interface ThemeKit {
  id: ThemeId;
  name: string;
  colors: ThemeColors;
  ui: UiKit;
}

const KITS = new Map<ThemeId, ThemeKit>();
export function getThemeKit(id: ThemeId): ThemeKit {
  let k = KITS.get(id);
  if (!k) {
    const d = getThemeDef(id);
    k = { id: d.id, name: d.name, colors: d.colors, ui: d.ui() };
    KITS.set(id, k);
  }
  return k;
}

export type { ThemeDef, ThemeColors, UiKit } from './types.ts';
export type { NineSlice, ButtonSet, PedestalSprites, Prop, ScenePlan } from './types.ts';
export { drawLogo, LOGO_W, LOGO_H } from './logo.ts';
export { drawFuse } from './fuse.ts';
