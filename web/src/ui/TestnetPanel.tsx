// The TESTNET panel (protocol v1.6), on the testnet demo only (test mode on testnet): the first row of the HUD
// above the room, so the HUD measures it and the room lays out under it. It shows only while the player holds
// nothing at all, in the wallet or in the game: one big button, "Airdrop 100 tREAL test tokens", and "No further
// action needed". Once the tokens land the panel is gone (a short note says where they are) and comes back only
// when wallet and game are both empty again. The small TESTNET marker by the logo stays throughout.

import { useEffect } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { symbolOf } from '../state/walletFunds.ts';
import { TESTNET_LINE, airdropLabel, airdropOn, beforeNote, panelMode, waitText } from '../state/airdrop.ts';
import { useNow } from './hooks.ts';
import { Button, Icon } from './kit.tsx';

export function TestnetPanel(p: { store: Store; kind: 'lobby' | 'chat' | 'call' | 'who' }) {
  const { store, kind } = p;
  const s = useStore(store);
  const now = useNow(15_000);
  const on = airdropOn(s.config) && !!s.accountId && kind === 'lobby';

  // the relay's view: when the player arrives, and again when their coins move (a round settled, a deposit)
  const balance = s.me ? Math.round((s.me.balanceCoins + s.me.lockedCoins) * 100) : null;
  useEffect(() => {
    if (!on || !s.welcomed) return;
    if (store.get().airdrop.status === undefined) {
      void store.actions.refreshAirdrop();
      return;
    }
    const t = setTimeout(() => void store.actions.refreshAirdrop(), 1200);
    return () => clearTimeout(t);
  }, [on, s.accountId, s.welcomed, balance]);

  const mode = on ? panelMode(s, kind, now) : 'none';
  if (mode === 'none') return null;
  const a = s.airdrop;
  const to = a.status?.to ?? (s.session?.accountId === s.accountId ? 'wallet' : 'game');
  const busy = mode === 'busy';
  return (
    <div class={'hud-tn' + (mode === 'error' ? ' err' : '')} role="region" aria-label="Testnet">
      <div class="hud-tn-head">
        <span class="hud-tn-badge">TESTNET</span>
        <span class="hud-tn-t"><span class="hud-tn-sep">·</span> {TESTNET_LINE}</span>
      </div>
      <div class="hud-tn-row">
        {mode === 'wait' ? (
          <span class="hud-tn-note">{waitText(a.status!.nextAt, now)}</span>
        ) : (
          <>
            <button type="button" class="hud-tn-cta" disabled={busy} aria-busy={busy} onClick={() => void store.actions.airdrop()}>
              <Icon name="coin" /> {busy ? 'Airdropping…' : mode === 'error' ? 'Try again' : airdropLabel(symbolOf(s.config))}
            </button>
            {mode === 'error' ? (
              <span class="hud-tn-note" role="alert"><Icon name="cross" /> {a.error?.text}</span>
            ) : (
              <span class="hud-tn-note">{busy ? (to === 'wallet' ? 'Sending them to your wallet…' : 'Sending them to your game balance…') : beforeNote(to)}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The same airdrop as a button in the coins screens (testnet only); a refusal shows where the button was.
 * `onLanded`: what the screen does next (the deposit field holds what just arrived).
 */
export function AirdropButton(p: { store: Store; small?: boolean; onLanded?(): void }) {
  const s = useStore(p.store);
  const busy = s.airdrop.phase === 'busy';
  return (
    <Button
      small={p.small}
      kind="primary"
      disabled={busy}
      onClick={async () => {
        if (await p.store.actions.airdrop()) p.onLanded?.();
      }}
    >
      <Icon name="coin" /> {busy ? 'Airdropping…' : airdropLabel(symbolOf(s.config))}
    </Button>
  );
}
