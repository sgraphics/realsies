// "Enable coins": the one wallet approval that lets this browser send a wallet player's plays and calls
// without popups. The browser makes its own key; the wallet adds it to the account as a function-call key
// for the game contract (play and call only, a small gas allowance). Free play never needs it.

import { useEffect } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { useEscape } from '../ui/hooks.ts';
import { txUrl } from '../state/format.ts';

/** yoctoNEAR (decimal string) as NEAR with up to 3 decimals: "0.25". */
export function nearOf(yocto: string | undefined, fallback = '0.25'): string {
  if (!yocto) return fallback;
  try {
    const milli = BigInt(yocto) / 10n ** 21n;
    return (Number(milli) / 1000).toString();
  } catch {
    return fallback;
  }
}

export function KeySetupDialog(p: { store: Store; onDone(enabled: boolean): void; why?: string }) {
  const s = useStore(p.store);
  const cfg = s.config;
  const f = s.keySetup;
  const busy = f.phase === 'wallet' || f.phase === 'checking';
  const account = s.session?.accountId ?? 'your account';
  const contract = cfg?.wallet?.playKey.receiverId ?? cfg?.contractId ?? 'the game';
  const allowance = nearOf(cfg?.wallet?.playKey.allowance);
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
    }, 1100);
    return () => clearTimeout(t);
  }, [f.phase]);

  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="modal narrow px-panel sheet-enter key-dialog" role="dialog" aria-modal="true" aria-label="Enable coins">
        <div class="px-col">
          <h2 class="px-title"><Icon name="bolt" /> Enable coins</h2>
          {p.why && <p class="px-sub px-note">{p.why}</p>}
          <p class="px-body">One approval in your wallet, then this browser sends your plays and calls itself. No popup for every chat.</p>
          <ul class="px-panel tight light key-facts">
            <li><Icon name="lock" /><span>This browser makes its own key. Your wallet adds it to <b class="key-acct">{account}</b>.</span></li>
            <li><Icon name="check" /><span>It can only <b>play</b> and <b>call</b> on <span class="key-acct">{contract}</span>.</span></li>
            <li><Icon name="flame" /><span>It may spend up to <b>{allowance} NEAR</b> of gas from your account, under 0.001 NEAR a chat.</span></li>
            <li><Icon name="shield" /><span>It can never withdraw or move your coins. That stays with your wallet.</span></li>
          </ul>
          {f.phase === 'wallet' && (
            <div class="flow-line" role="status">
              <span class="flow-dots" aria-hidden="true"><i /><i /><i /></span>
              <span>{f.via === 'transaction' ? 'Approve the key in your wallet (one transaction).' : 'Approve the key in your wallet.'}</span>
            </div>
          )}
          {f.phase === 'checking' && (
            <div class="flow-line" role="status">
              <span class="flow-dots" aria-hidden="true"><i /><i /><i /></span>
              <span>Checking the key on NEAR…</span>
            </div>
          )}
          {f.note && busy && <p class="px-sub px-dim">{f.note}</p>}
          {f.phase === 'done' && <p class="px-sub px-good"><Icon name="check" /> Coins enabled in this browser.{f.tx && <> <a class="px-link" href={txUrl(cfg, f.tx)} target="_blank" rel="noreferrer">View transaction <Icon name="link" /></a></>}</p>}
          {f.phase === 'error' && <p class="px-sub px-bad flow-error"><Icon name="cross" /> {f.error}</p>}
          <div class="px-row between">
            <Button kind="primary" disabled={busy || f.phase === 'done'} onClick={() => void p.store.actions.enableCoins()}>
              <Icon name="shield" /> {f.phase === 'error' ? 'Try again' : 'Approve in wallet'}
            </Button>
            <Button kind="ghost" disabled={busy} onClick={close}>{f.phase === 'done' ? 'Done' : 'Not now'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
