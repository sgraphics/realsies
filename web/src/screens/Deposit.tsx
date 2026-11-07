// "Deposit to earn": shown before entering a room while the balance is zero (skippable), and as
// the coins panel from the HUD. A test player (the testnet demo) gets the airdrop: 100 test tokens
// straight into the game balance, within its limits (protocol v1.6). A wallet player gets the wallet
// version (WalletCoins.tsx): deposit and withdraw through the wallet, as on mainnet.

import { useEffect, useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { useEscape } from '../ui/hooks.ts';
import { txUrl } from '../state/format.ts';
import { WalletCoinsDialog } from './WalletCoins.tsx';
import { airdropOn, holdsEnough } from '../state/airdrop.ts';
import { AirdropButton } from '../ui/TestnetPanel.tsx';

export function DepositDialog(p: { store: Store; gate: boolean; onDone(): void; onEnableCoins?(): void; prefill?: string }) {
  const s = useStore(p.store);
  // a wallet player's own coins screen (the session is this very account), or no coin yet
  if ((s.session && s.session.accountId === s.accountId) || s.config?.coinsOpen === false) return <WalletCoinsDialog store={p.store} gate={p.gate} onDone={p.onDone} onEnableCoins={p.onEnableCoins ?? (() => {})} prefill={p.prefill} />;
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
  // the airdrop is for those holding little: with 50 or more in the game there is nothing to offer
  const airdrop = airdropOn(cfg) && !holdsEnough(drop.status);
  const landed = drop.phase === 'done' && drop.landed?.to === 'game' ? drop.landed : undefined;
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
          {airdrop ? (
            <>
              <AirdropButton store={p.store} onLanded={() => p.gate && setTimeout(p.onDone, 900)} />
              <p class="px-sub px-dim">Test tokens, no real money: straight into your game balance.</p>
            </>
          ) : !airdropOn(cfg) && !cfg?.testMode ? (
            <p class="px-sub px-dim">Deposits arrive from your wallet in one step.</p>
          ) : null}
          {drop.phase === 'error' && drop.error && <p class="px-sub px-bad" role="alert"><Icon name="cross" /> {drop.error.text}</p>}
          {landed && (
            <p class="px-sub px-good">
              <Icon name="check" /> {landed.coins} test tokens are in your game balance. <a class="px-link" href={txUrl(cfg, landed.tx)} target="_blank" rel="noreferrer">View transaction <Icon name="link" /></a>
            </p>
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
