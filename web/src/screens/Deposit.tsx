// "Deposit to earn": shown before entering a room while the balance is zero (skippable), and as
// the coins panel from the HUD. Only what a player needs: the balance, the airdrop while a test player
// holds nothing (the testnet demo: 100 test tokens straight into the game balance, protocol v1.6),
// withdraw while the game holds coins, and Play free. A wallet player gets the wallet version
// (WalletCoins.tsx): deposit and withdraw through the wallet, as on mainnet.

import { useEffect, useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { useEscape } from '../ui/hooks.ts';
import { fmtCoins, txUrl } from '../state/format.ts';
import { WalletCoinsDialog } from './WalletCoins.tsx';
import { airdropOn, holdsEnough } from '../state/airdrop.ts';
import { AirdropButton } from '../ui/TestnetPanel.tsx';

export function DepositDialog(p: { store: Store; gate: boolean; onDone(): void; prefill?: string }) {
  const s = useStore(p.store);
  // a wallet player's own coins screen (the session is this very account), or no coin yet
  if ((s.session && s.session.accountId === s.accountId) || s.config?.coinsOpen === false) return <WalletCoinsDialog store={p.store} gate={p.gate} onDone={p.onDone} prefill={p.prefill} />;
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
  useEffect(() => {
    void p.store.actions.refreshAirdrop();
  }, [p.store]);
  const balance = me?.balanceCoins ?? 0;
  const usd = cfg?.usdPerCoin ?? 0.01;
  const drop = s.airdrop;
  // a test player has no wallet: the airdrop stands in for a deposit while the game holds nothing
  const airdrop = airdropOn(cfg) && balance === 0 && !holdsEnough(drop.status);
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
      <div class="modal narrow px-panel sheet-enter wallet-dialog" role="dialog" aria-modal="true" aria-label={balance > 0 ? 'Your coins' : 'Deposit to earn'}>
        <div class="px-col">
          <h2 class="px-title"><Icon name="coin" /> {balance > 0 ? 'Your coins' : 'Deposit to earn'}</h2>
          <p class="px-sub wallet-hold">
            In the game: <b>{fmtCoins(balance)} coins</b>{balance > 0 ? <> (about ${(balance * usd).toFixed(2)})</> : null}{me?.lockedCoins ? <>, {fmtCoins(me.lockedCoins)} on the table</> : null}
          </p>
          {!!me?.lockedBonusCoins && <p class="px-sub wallet-hold"><Icon name="lock" /> {fmtCoins(me.lockedBonusCoins)} bonus coins unlock with your next deposit.</p>}
          {airdrop && <AirdropButton store={p.store} onLanded={() => p.gate && setTimeout(p.onDone, 900)} />}
          {balance === 0 && drop.phase === 'error' && drop.error && <p class="px-sub px-bad" role="alert"><Icon name="cross" /> {drop.error.text}</p>}
          {balance > 0 && (
            <form class="custom-row" onSubmit={(e) => { e.preventDefault(); withdraw(); }}>
              <input class="px-input" type="number" inputMode="numeric" min={1} max={balance} placeholder="Coins" value={wd} onInput={(e) => setWd((e.target as HTMLInputElement).value)} aria-label="Coins to withdraw" />
              <Button type="submit" disabled={busy || !(Number(wd) > 0 && Number(wd) <= balance)}>Withdraw</Button>
            </form>
          )}
          {tx && (
            <p class="px-sub px-good">
              <Icon name="check" /> Done. <a class="px-link" href={txUrl(cfg, tx)} target="_blank" rel="noreferrer">View transaction <Icon name="link" /></a>
            </p>
          )}
          {err && <p class="px-sub px-bad"><Icon name="cross" /> {err}</p>}
          <div class="px-row between">
            <Button kind={balance > 0 ? 'primary' : 'default'} onClick={p.onDone}>{balance > 0 ? 'Back to the room' : 'Play free'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
