// Scene module: layouts (rects for DOM placement) and the renderer.
export * from './types.ts';
export { layoutLobby, layoutChat, layoutCall, layoutHall, innerRect, pillarTextRect, seatAt, FRAME, ARCH_T, PED_W, PED_H, CHAR_ON_PED, PLAQUE, TABS_W, TABS_H } from './layout.ts';
export type { CallLayoutX, HallLayoutX } from './layout.ts';
export { SceneRenderer, drawPedestal, renderPortrait, pedestalsOf } from './renderer.ts';
