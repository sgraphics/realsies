// Scene module: layouts (rects for DOM placement), the scale chooser and the renderer.
export * from './types.ts';
export { layoutLobby, layoutChat, layoutCall, layoutHall, chooseScale, labelSpec, innerRect, seatAt, FRAME, ARCH_T, PED_W, PED_H, CHAR_ON_PED, LABEL_DY } from './layout.ts';
export type { CallLayoutX, HallLayoutX, LayoutOpts } from './layout.ts';
export { SceneRenderer, drawPedestal, renderPortrait, pedestalsOf, dimRoom } from './renderer.ts';
