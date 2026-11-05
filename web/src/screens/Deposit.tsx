// "Deposit to earn": shown before entering a room while the balance is zero (skippable), and as
// the coins panel from the HUD. Test mode: the faucet sends 100 test coins. A wallet player gets the
// wallet version (WalletCoins.tsx): deposit and withdraw through the wallet.

import { useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { useEscape } from '../ui/hooks.ts';
import { txUrl } from '../state/format.ts';
import { WalletCoinsDialog } from './WalletCoins.tsx';

export function DepositDialog(p: { store: Store; gate: boolean; onDone(): void; onEnableCoins?(): void }) {
  const s = useStore(p.store);
  if (s.session || s.config?.coinsOpen === false) return <WalletCoinsDialog store={p.store} gate={p.gate} onDone={p.onDone} onEnableCoins={p.onEnableCoins ?? (() => {})} />;
  return <TestCoinsDialog {...p} />;
}

function TestCoinsDialog(p: { store: Store; gate: boolean; onDone(): void }) {
  const s = useStore(p.store);
  const me = s.me;
  const cfg = s.config;
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wd, setWd] = useState('');
  useEscape(p.onDone);
  const balance = me?.balanceCoins ?? 0;
  const symbol = cfg?.tokenSymbol ?? 'tREAL';
  const usd = cfg?.usdPerCoin ?? 0.01;

  const faucet = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await p.store.actions.faucet(100);
      setTx(r.tx);
      if (p.gate) setTimeout(p.onDone, 900);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    const n = Math.floor(Number(wd));
    if (!(n > 0 && n <= balance)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await p.store.actions.withdraw(n);
      setTx(r.tx);
      setWd('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && p.onDone()}>
      <div class="modal narrow px-panel sheet-enter" role="dialog" aria-modal="true" aria-label="Deposit to earn">
        <div class="px-col">
          <h2 class="px-title"><Icon name="coin" /> {balance > 0 ? 'Your coins' : 'Deposit to earn'}</h2>
          {balance > 0 ? (
            <p class="px-body">You have <b>{balance.toLocaleString('en-US')}</b> coins (about ${(balance * usd).toFixed(2)}){me?.lockedCoins ? <>, plus {me.lockedCoins} on the table until the round ends</> : null}.</p>
          ) : (
            <>
              <p class="px-body">Free mode: you chat, call, score and get rated, but no coins move either way.</p>
              <p class="px-body">With coins on the table, a right call shares the coins of everyone who called it wrong. Fool the room and you earn a Turing bonus too.</p>
            </>
          )}
          {!!me?.lockedBonusCoins && (
            <div class="px-panel tight light">
              <p class="px-sub"><Icon name="lock" /> {me.lockedBonusCoins} coins earned from players who thought you were a bot. Deposit to unlock.</p>
            </div>
          )}
          {cfg?.testMode ? (
            <Button kind="primary" disabled={busy} onClick={faucet}>
              <Icon name="coin" /> {busy ? 'Sending…' : `Get 100 test coins (${symbol})`}
            </Button>
          ) : (
            <p class="px-sub px-dim">Deposits arrive from your wallet in one step.</p>
          )}
          {tx && (
            <p class="px-sub px-good">
              <Icon name="check" /> Done. <a class="px-link" href={txUrl(cfg, tx)} target="_blank" rel="noreferrer">View transaction <Icon name="link" /></a>
            </p>
          )}
          {err && <p class="px-sub px-bad"><Icon name="cross" /> {err}</p>}
          {balance > 0 && (
            <form class="custom-row" onSubmit={(e) => { e.preventDefault(); withdraw(); }}>
              <input class="px-input" type="number" inputMode="numeric" min={1} max={balance} placeholder="Coins" value={wd} onInput={(e) => setWd((e.target as HTMLInputElement).value)} aria-label="Coins to withdraw" />
              <Button type="submit" disabled={busy || !(Number(wd) > 0 && Number(wd) <= balance)}>Withdraw</Button>
            </form>
          )}
          <div class="px-row between">
            <Button kind={balance > 0 ? 'primary' : 'default'} onClick={p.onDone}>{balance > 0 ? 'Back to the room' : 'Play free'}</Button>
            {p.gate && balance === 0 && <span class="px-dim" style={{ fontSize: '13px' }}>You can deposit any time: tap your coins at the top.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
