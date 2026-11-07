// The one approval a wallet player's paid play needs when this browser has no play key yet and no wallet
// transaction brought one along (a deposit or a withdrawal adds it in the same approval): it opens by itself
// when a paid amount is picked, says it as one step, and goes on with the same pick once the key is on chain.
// The browser makes its own key; the wallet adds it to the account as a function-call key for the game contract
// (play and call only, a small gas allowance). Cancel goes back to where the pick was made.

import { useEffect } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { useEscape } from '../ui/hooks.ts';

export const ONE_APPROVAL = 'One approval in your wallet, then your plays and calls run without popups.';

export function KeySetupDialog(p: { store: Store; onDone(enabled: boolean): void; why?: string }) {
  const s = useStore(p.store);
  const f = s.keySetup;
  const busy = f.phase === 'wallet' || f.phase === 'checking';
  const close = () => {
    if (busy) return;
    p.store.actions.resetFlow('keySetup');
    p.onDone(p.store.actions.coinsEnabled());
  };
  useEscape(close);
  useEffect(() => {
    if (f.phase !== 'done') return;
    const t = setTimeout(() => {
      p.store.actions.resetFlow('keySetup');
      p.onDone(true);
    }, 600);
    return () => clearTimeout(t);
  }, [f.phase]);

  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="modal narrow px-panel sheet-enter key-dialog" role="dialog" aria-modal="true" aria-label="Play with coins">
        <div class="px-col">
          <h2 class="px-title"><Icon name="coin" /> Play with coins</h2>
          {p.why && <p class="px-sub px-note">{p.why}</p>}
          <p class="px-body">{ONE_APPROVAL}</p>
          <p class="px-dim key-fine">It can only play and call in Realsies. It can never move your coins.</p>
          {busy && (
            <div class="flow-line" role="status">
              <span class="flow-dots" aria-hidden="true"><i /><i /><i /></span>
              <span>{f.phase === 'wallet' ? 'Approve in your wallet.' : 'Checking on NEAR…'}</span>
            </div>
          )}
          {f.note && busy && <p class="px-sub px-dim">{f.note}</p>}
          {f.phase === 'done' && <p class="px-sub px-good"><Icon name="check" /> Done.</p>}
          {f.phase === 'error' && <p class="px-sub px-bad flow-error"><Icon name="cross" /> {f.error}</p>}
          <div class="px-row between">
            <Button kind="primary" disabled={busy || f.phase === 'done'} onClick={() => void p.store.actions.enableCoins()}>
              <Icon name="check" /> {f.phase === 'error' ? 'Try again' : 'Approve'}
            </Button>
            <Button kind="ghost" disabled={busy} onClick={close}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
