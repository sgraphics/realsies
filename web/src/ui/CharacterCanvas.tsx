// Idling character on its own small canvas (thumbnails, seat dialog, results rows, who-are-you).
// <CharacterCanvas seed size talking? lookDir? react? />  size = CSS px height; integer scale of 48.
import { useEffect, useRef } from 'preact/hooks';
import { createCharacter, type CharacterController } from '../../../art/src/browser/index.ts';
import type { Reaction } from '../../../art/src/rig/rig.ts';

export interface CharacterCanvasProps {
  seed: string;
  /** Height in CSS pixels; the canvas uses the largest integer scale of 48 device pixels that fits. */
  size?: number;
  talking?: boolean;
  lookDir?: -1 | 0 | 1;
  /** Change this value to play a reaction once. */
  reaction?: { kind: Reaction; n: number } | null;
  flipX?: boolean;
  class?: string;
  title?: string;
}

export function CharacterCanvas({ seed, size = 96, talking = false, lookDir = 0, reaction, flipX, class: cls, title }: CharacterCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ctl = useRef<CharacterController | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    ctl.current = createCharacter(c, seed, { flipX });
    return () => {
      ctl.current?.destroy();
      ctl.current = null;
    };
  }, [seed, flipX]);
  useEffect(() => ctl.current?.setTalking(talking), [talking, seed]);
  useEffect(() => ctl.current?.lookToward(lookDir), [lookDir, seed]);
  useEffect(() => {
    if (reaction) ctl.current?.react(reaction.kind);
  }, [reaction?.n]);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const k = Math.max(1, Math.floor((size * dpr) / 48));
  const cssW = (32 * k) / dpr, cssH = (48 * k) / dpr;
  return <canvas ref={ref} width={32} height={48} title={title} class={'px-char ' + (cls ?? '')} style={{ width: cssW + 'px', height: cssH + 'px' }} />;
}
