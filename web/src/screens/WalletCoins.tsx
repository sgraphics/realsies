// Coins for a wallet player, the same on testnet and mainnet, and only what a player needs: the balances, the
// deposit row (ft_transfer_call on the coin to the game contract), withdraw while the game holds coins, Buy on
// mainnet, and Play free. The browser's play key is no step of its own: it rides along in the first deposit or
// withdrawal (one wallet approval, see wallet/batch.ts), and a small line under the deposit row says so until the
// key exists. A deposit the wallet cannot cover is never offered: the reason sits where the button would act (an
// empty wallet, or too few coins for the amount). The one testnet difference: an empty wallet is offered the
// airdrop ("Airdrop 100 tREAL test tokens", protocol v1.6) where mainnet offers "Buy REAL". While the contract has
// no coin (mainnet before REAL launches): free play only.

import { useEffect, useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { useEscape } from '../ui/hooks.ts';
import { fmtCoins, txUrl } from '../state/format.ts';
import { depositCheck, emptyWalletText, fmtTokens, shortWalletText, symbolOf } from '../state/walletFunds.ts';
import { airdropOn, holdsEnough } from '../state/airdrop.ts';
import { AirdropButton } from '../ui/TestnetPanel.tsx';

/** The contract has no coin yet (mainnet until the REAL token launches on meme.cooking). */
export function CoinsClosed(p: { buyUrl?: string; onDone(): void }) {
  return (
    <>
      <p class="px-body"><b>Coins open when $REAL launches.</b></p>
      <p class="px-body">Until then everyone plays free: chats, calls and ratings all count, and no coins move.</p>
      {p.buyUrl && (
        <a class="px-btn buy-link" href={p.buyUrl} target="_blank" rel="noreferrer"><Icon name="coin" /> Get $REAL at the launch <Icon name="link" /></a>
      )}
      <div class="px-row between">
        <Button kind="primary" onClick={p.onDone}>Play free</Button>
      </div>
    </>
  );
}

export const FIRST_DEPOSIT = 'First deposit: one wallet approval. After that, plays run without popups.';

export function WalletCoinsDialog(p: { store: Store; gate: boolean; onDone(): void; prefill?: string }) {
  const s = useStore(p.store);
  const me = s.me;
  const cfg = s.config;
  const f = s.walletTx;
  const [dep, setDep] = useState(p.prefill ?? '');
  const [wd, setWd] = useState('');
  useEscape(p.onDone);
  useEffect(() => {
    void p.store.actions.refreshWalletInfo();
    void p.store.actions.refreshAirdrop();
    return () => p.store.actions.resetFlow('walletTx');
  }, [p.store]);
  // an amount handed in while the dialog is already open (it may have opened on its own as the deposit gate)
  useEffect(() => {
    if (p.prefill) setDep(p.prefill);
  }, [p.prefill]);
  const balance = me?.balanceCoins ?? 0;
  const symbol = symbolOf(cfg);
  const usd = cfg?.usdPerCoin ?? 0.01;
  const busy = f.phase === 'wallet' || f.phase === 'checking';
  const closed = cfg?.coinsOpen === false;
  // the play key rides along in the first deposit (or withdrawal): no step of its own
  const keyed = p.store.actions.coinsEnabled();
  const depN = Math.floor(Number(dep));
  const wdN = Math.floor(Number(wd));
  const decimals = cfg?.tokenDecimals ?? 18;
  const chk = depositCheck(s.walletInfo, depN > 0 ? depN : 0, cfg?.coinUnit);
  const empty = chk.reason === 'empty';
  const short = depN > 0 && chk.reason === 'short';
  // testnet: an empty wallet gets the airdrop; mainnet: the Buy link
  const testnet = airdropOn(cfg);
  const airdrop = testnet && !holdsEnough(s.airdrop.status);
  const buy = !cfg?.testMode ? cfg?.buyUrl : undefined;
  const drop = s.airdrop;
  /** the airdrop landed in the wallet: the deposit field holds what the wallet can cover */
  const afterAirdrop = () => {
    const fits = depositCheck(p.store.get().walletInfo, 0, cfg?.coinUnit).fits;
    setDep((cur) => {
      const n = Math.floor(Number(cur));
      if (n > 0 && (fits === null || BigInt(n) <= fits)) return cur;
      return String(fits === null ? 100 : fits < 100n ? fits : 100n);
    });
  };

  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && !busy && p.onDone()}>
      <div class="modal narrow px-panel sheet-enter wallet-dialog" role="dialog" aria-modal="true" aria-label={balance > 0 ? 'Your coins' : 'Deposit to earn'}>
        <div class="px-col">
          <h2 class="px-title"><Icon name="coin" /> {closed ? 'Coins' : balance > 0 ? 'Your coins' : 'Deposit to earn'}</h2>
          {closed ? (
            <CoinsClosed buyUrl={cfg?.buyUrl} onDone={p.onDone} />
          ) : (
            <>
              {(balance > 0 || !!me?.lockedCoins) && (
                <p class="px-sub wallet-hold">
                  In the game: <b>{fmtCoins(balance)} coins</b> (about ${(balance * usd).toFixed(2)}){me?.lockedCoins ? <>, {fmtCoins(me.lockedCoins)} on the table</> : null}
                </p>
              )}
              {chk.walletUnits !== null && (
                <p class="px-sub wallet-hold">
                  In your wallet: <b>{fmtTokens(chk.walletUnits, decimals)} {symbol}</b>
                  {buy && !empty && <> · <a class="px-link" href={buy} target="_blank" rel="noreferrer">Buy {symbol} <Icon name="link" /></a></>}
                </p>
              )}
              {!!me?.lockedBonusCoins && <p class="px-sub wallet-hold"><Icon name="lock" /> {fmtCoins(me.lockedBonusCoins)} bonus coins unlock with your next deposit.</p>}
              <form class="custom-row" onSubmit={(e) => { e.preventDefault(); if (depN > 0 && !busy && chk.ok) void p.store.actions.walletDeposit(depN); }}>
                <input class="px-input" type="number" inputMode="numeric" min={1} placeholder="Coins" value={dep} onInput={(e) => setDep((e.target as HTMLInputElement).value)} aria-label="Coins to deposit" />
                <Button type="submit" kind={balance > 0 ? 'default' : 'primary'} disabled={busy || !(depN > 0) || !chk.ok}><Icon name="coin" /> Deposit</Button>
              </form>
              {!keyed && <p class="px-dim wallet-note">{FIRST_DEPOSIT}</p>}
              {empty && (testnet ? airdrop : !!buy) && (
                <div class="px-row wallet-why" role="status">
                  <p class="px-sub">{emptyWalletText(symbol)}</p>
                  {testnet ? (
                    <AirdropButton store={p.store} small onLanded={afterAirdrop} />
                  ) : (
                    <a class="px-btn small primary buy-link" href={buy} target="_blank" rel="noreferrer"><Icon name="coin" /> Buy {symbol} <Icon name="link" /></a>
                  )}
                </div>
              )}
              {empty && !(testnet ? airdrop : !!buy) && <p class="px-sub wallet-why" role="status">{emptyWalletText(symbol)}</p>}
              {empty && testnet && drop.phase === 'error' && drop.error && <p class="px-sub px-bad wallet-why" role="alert"><Icon name="cross" /> {drop.error.text}</p>}
              {short && <p class="px-sub wallet-why" role="status">{shortWalletText(symbol, chk.walletUnits!, decimals, chk.fits!)}</p>}
              {balance > 0 && (
                <form class="custom-row" onSubmit={(e) => { e.preventDefault(); if (wdN > 0 && wdN <= balance && !busy) void p.store.actions.walletWithdraw(wdN); }}>
                  <input class="px-input" type="number" inputMode="numeric" min={1} max={Math.floor(balance)} placeholder="Coins" value={wd} onInput={(e) => setWd((e.target as HTMLInputElement).value)} aria-label="Coins to withdraw" />
                  <Button type="submit" disabled={busy || !(wdN > 0 && wdN <= balance)}>Withdraw</Button>
                </form>
              )}
              {busy && (
                <div class="flow-line" role="status">
                  <span class="flow-dots" aria-hidden="true"><i /><i /><i /></span>
                  <span>{f.phase === 'wallet' ? 'Approve in your wallet.' : 'Checking on NEAR…'}</span>
                </div>
              )}
              {f.phase === 'done' && (
                <p class="px-sub px-good">
                  <Icon name="check" /> {f.kind === 'withdraw' ? 'Withdrawn to your wallet.' : 'Deposited.'}
                  {f.tx && <> <a class="px-link" href={txUrl(cfg, f.tx)} target="_blank" rel="noreferrer">View transaction <Icon name="link" /></a></>}
                </p>
              )}
              {f.phase === 'error' && <p class="px-sub px-bad flow-error"><Icon name="cross" /> {f.error}</p>}
              <div class="px-row between">
                <Button kind={balance > 0 ? 'primary' : 'default'} disabled={busy} onClick={p.onDone}>{balance > 0 ? 'Back to the room' : 'Play free'}</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
