// The Realsies pixel engine, imported by relative path from ../art (no npm workspaces). Every
// trailer module reaches the engine through this one file, so the engine can move without a hunt.

export { type Rgba, createBuffer, blit, get, px, rect, line, ellipse, nineSlice, outline } from '../../art/src/core/buffer.ts';
export { type Color, type Ramp, PAL, RAMPS, TRANSPARENT, darker, lighter, nearest, luminance } from '../../art/src/core/palette.ts';
export { rngFrom, randomSeed, hash01 } from '../../art/src/core/rng.ts';
export { Rig } from '../../art/src/rig/rig.ts';
export { lookFromSeed, type Look } from '../../art/src/rig/look.ts';
export { buildSprites, type LayerSprites } from '../../art/src/rig/build.ts';
export { torsoSpan, TORSOS } from '../../art/src/rig/parts/body.ts';
export { EYES, MOUTHS } from '../../art/src/rig/parts/head.ts';
export { HAIRS } from '../../art/src/rig/parts/hair.ts';
export { FRONTS } from '../../art/src/rig/parts/items.ts';
export { layoutLobby, layoutChat, layoutCall } from '../../art/src/scene/layout.ts';
export { SceneRenderer } from '../../art/src/scene/renderer.ts';
export type { CallLayout, ChatLayout, LobbyLayout, Rect, SceneSeat } from '../../art/src/scene/types.ts';
export { getThemeKit } from '../../art/src/themes/index.ts';
export { drawLogo, LOGO_W, LOGO_H } from '../../art/src/themes/logo.ts';
export { countdownSprite, countdownStyle, renderVsDoor } from '../../art/src/ui/countdown.ts';
export { icon } from '../../art/src/ui/icons.ts';
export type { ThemeId } from '../../shared/protocol.ts';
