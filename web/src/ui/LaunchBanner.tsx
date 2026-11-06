// The launch banner in the game (protocol v1.4), from the moment REAL's auction and the mainnet game open until
// coins open: "REAL auction is live · ends in hh:mm · Get REAL" while the auction runs, "REAL is finalizing · coins
// open soon" after it, then nothing. It is the first row of the HUD, so the HUD measures it and the world (the chat
// input included) lays out under it; in a chat on a phone it steps aside so the chat keeps every pixel. Hidden per
// phase with its ×. The testnet demo never shows it (bannerPhase needs a relay without test mode).

import { useEffect, useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { bannerPhase, fmtHm, tokenUrlOf } from '../launch/phase.ts';
import { useNow } from './hooks.ts';
import { Icon } from './kit.tsx';

const KEY = 'realsies:launch-banner:hidden';

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

/** A phone, or a screen too short to give a chat any less room. */
function cramped(): boolean {
  return typeof window !== 'undefined' && (window.innerWidth < 700 || window.innerHeight < 600);
}

export function LaunchBanner(p: { store: Store; chat?: boolean }) {
  const s = useStore(p.store);
  const now = useNow(5000);
  const phase = bannerPhase(s.config, now);
  const [hidden, setHidden] = useState(readHidden);
  // without a socket (the sign-in screen) nobody pushes the coin being set: read the config again every minute
  const connected = s.status === 'open';
  useEffect(() => {
    if (!phase || connected) return;
    const t = setInterval(() => void p.store.actions.loadConfig().catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [phase, connected]);

  const l = s.config?.launch;
  if (!phase || !l) return null;
  const key = `${phase}:${l.auctionEnd ?? ''}`;
  if (hidden === key || (p.chat && cramped())) return null;
  const narrow = typeof window !== 'undefined' && window.innerWidth < 480;
  const token = tokenUrlOf(s.config);
  const left = l.auctionEnd !== undefined ? fmtHm(l.auctionEnd - now) : null;
  const hide = () => {
    writeHidden(key);
    setHidden(key);
  };
  return (
    <div class={'hud-launch ' + phase} role="status">
      {phase === 'auction' ? (
        <>
          {!narrow && <span class="hud-launch-dot" aria-hidden="true" />}
          <span class="hud-launch-t">
            <b>{narrow ? 'REAL auction live' : 'REAL auction is live'}</b>
            {left && <span class="hud-launch-sep"> · </span>}
            {left && (narrow ? <><span class="hud-n">{left}</span> left</> : <>ends in <span class="hud-n">{left}</span></>)}
          </span>
          {token && <a class="hud-launch-cta" href={token} target="_blank" rel="noopener">Get REAL</a>}
        </>
      ) : (
        <>
          <Icon name="clock" class="hud-launch-icon" />
          <span class="hud-launch-t">
            <b>REAL is finalizing</b>
            <span class="hud-launch-sep"> · </span>coins open soon
          </span>
        </>
      )}
      <button type="button" class="hud-launch-x" title="Hide" aria-label="Hide this" onClick={hide}>×</button>
    </div>
  );
}
