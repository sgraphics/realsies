// Turing Hour (protocol v1.13): one slim line in the room, in the launch banner's place and style, from 6 hours
// before the hour ("Turing Hour today at 22:00: real people in the room. Starts in 3 h 12 min.") until its end ("Turing
// Hour is on until 23:00: real people are here now."). The words come from launch/turing.ts. Only in the room (a chat
// keeps every pixel), never with the launch banner or the TESTNET panel, and on a phone held upright in fewer words so
// it stays one line and the room does not move. Hidden per hour with its ×.

import { useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { turingLine } from '../launch/turing.ts';
import { panelMode } from '../state/airdrop.ts';
import { useNow } from './hooks.ts';
import { Icon } from './kit.tsx';

const KEY = 'realsies:turing-banner:hidden';

function readHidden(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}
function writeHidden(v: string): void {
  try {
    globalThis.localStorage?.setItem(KEY, v);
  } catch {
    /* private mode: hidden until the page reloads */
  }
}

export function TuringBanner(p: { store: Store }) {
  const s = useStore(p.store);
  // the countdown is in whole minutes: a few ticks a minute keep it on time
  const now = useNow(10_000);
  const [hidden, setHidden] = useState(readHidden);
  const line = turingLine(s.config, now);
  if (!line || panelMode(s, 'lobby', now) !== 'none') return null;
  const key = `${line.phase}:${line.start}`;
  if (hidden === key) return null;
  const narrow = typeof window !== 'undefined' && window.innerWidth < 480;
  const hide = () => {
    writeHidden(key);
    setHidden(key);
  };
  return (
    <div class={'hud-launch turing-' + line.phase} role="status">
      {line.phase === 'on' ? <span class="hud-launch-dot" aria-hidden="true" /> : <Icon name="clock" class="hud-launch-icon" />}
      <span class="hud-launch-t" title={line.text}>{narrow ? line.short : line.text}</span>
      <button type="button" class="hud-launch-x" title="Hide" aria-label="Hide this" onClick={hide}>×</button>
    </div>
  );
}
