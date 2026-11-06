// Coins for a wallet player: deposit (ft_transfer_call on the coin to the game contract) and withdraw
// (withdraw on the game contract) through the wallet, a "Buy REAL" link, the play key status, and in test
// mode the faucet. While the contract has no coin (mainnet before REAL launches): free play only.

import { useEffect, useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { useEscape } from '../ui/hooks.ts';
import { fmtCoins, txUrl } from '../state/format.ts';

/** Coins per REAL as the screen says it: "1 coin = 100 REAL". */
export function coinInTokens(coinUnit: string | undefined, decimals: number | undefined): string | null {
  if (!coinUnit || decimals === undefined) return null;
  try {
    const u = BigInt(coinUnit);
    const one = 10n ** BigInt(decimals);
    const whole = u / one;
    const frac = u % one;
    if (frac === 0n) return whole.toLocaleString('en-US');
    return (Number(u) / Number(one)).toLocaleString('en-US', { maximumFractionDigits: 6 });
  } catch {
    return null;
  }
}

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

export function WalletCoinsDialog(p: { store: Store; gate: boolean; onDone(): void; onEnableCoins(): void }) {
  const s = useStore(p.store);
  const me = s.me;
  const cfg = s.config;
  const f = s.walletTx;
  const [dep, setDep] = useState('');
  const [wd, setWd] = useState('');
  useEscape(p.onDone);
  useEffect(() => {
    void p.store.actions.refreshWalletInfo();
    return () => p.store.actions.resetFlow('walletTx');
  }, [p.store]);
  const balance = me?.balanceCoins ?? 0;
  const symbol = cfg?.network === 'testnet' ? cfg?.tokenSymbol ?? 'tREAL' : 'REAL';
  const usd = cfg?.usdPerCoin ?? 0.01;
  const busy = f.phase === 'wallet' || f.phase === 'checking';
  const closed = cfg?.coinsOpen === false;
  const enabled = p.store.actions.coinsEnabled();
  const perCoin = coinInTokens(cfg?.coinUnit, cfg?.tokenDecimals);
  const depN = Math.floor(Number(dep));
  const wdN = Math.floor(Number(wd));
  const info = s.walletInfo;

  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && !busy && p.onDone()}>
      <div class="modal narrow px-panel sheet-enter wallet-dialog" role="dialog" aria-modal="true" aria-label={balance > 0 ? 'Your coins' : 'Deposit to earn'}>
        <div class="px-col">
          <h2 class="px-title"><Icon name="coin" /> {closed ? 'Coins' : balance > 0 ? 'Your coins' : 'Deposit to earn'}</h2>
          {closed ? (
            <CoinsClosed buyUrl={cfg?.buyUrl} onDone={p.onDone} />
          ) : (
            <>
              {balance > 0 ? (
                <p class="px-body">You have <b>{fmtCoins(balance)}</b> coins in the game (about ${(balance * usd).toFixed(2)}){me?.lockedCoins ? <>, plus {fmtCoins(me.lockedCoins)} on the table until the round ends</> : null}.</p>
              ) : (
                <p class="px-body">Free mode: you chat, call and get rated, but no coins move. With coins on the table, a right call shares the coins of everyone who called it wrong.</p>
              )}
              {!!me?.lockedBonusCoins && (
                <div class="px-panel tight light">
                  <p class="px-sub"><Icon name="lock" /> {me.lockedBonusCoins} coins earned from players who thought you were a bot. Your next deposit unlocks them.</p>
                </div>
              )}
              <form class="custom-row" onSubmit={(e) => { e.preventDefault(); if (depN > 0 && !busy) void p.store.actions.walletDeposit(depN); }}>
                <input class="px-input" type="number" inputMode="numeric" min={1} placeholder="Coins" value={dep} onInput={(e) => setDep((e.target as HTMLInputElement).value)} aria-label="Coins to deposit" />
                <Button type="submit" kind={balance > 0 ? 'default' : 'primary'} disabled={busy || !(depN > 0)}><Icon name="coin" /> Deposit from wallet</Button>
              </form>
              <p class="px-dim wallet-rate">
                {perCoin ? <>1 coin = {perCoin} {symbol}. </> : null}
                {cfg?.buyUrl && <a class="px-link" href={cfg.buyUrl} target="_blank" rel="noreferrer">Buy {symbol} <Icon name="link" /></a>}
              </p>
              {cfg?.testMode && (
                <div class="px-row wallet-tools">
                  <Button small disabled={busy} onClick={() => void p.store.actions.faucet(100).catch(() => {})}><Icon name="coin" /> 100 test coins to play</Button>
                  <Button small disabled={busy} onClick={() => void p.store.actions.faucetToWallet(100)}><Icon name="coin" /> 100 {symbol} to my wallet</Button>
                </div>
              )}
              {balance > 0 && (
                <>
                  <form class="custom-row" onSubmit={(e) => { e.preventDefault(); if (wdN > 0 && wdN <= balance && !busy) void p.store.actions.walletWithdraw(wdN); }}>
                    <input class="px-input" type="number" inputMode="numeric" min={1} max={Math.floor(balance)} placeholder="Coins" value={wd} onInput={(e) => setWd((e.target as HTMLInputElement).value)} aria-label="Coins to withdraw" />
                    <Button type="submit" disabled={busy || !(wdN > 0 && wdN <= balance)}>Withdraw to wallet</Button>
                  </form>
                  {info && !info.tokenRegistered && <p class="px-dim wallet-rate">Your account registers on {symbol} first, in the same approval.</p>}
                </>
              )}
              {f.phase === 'wallet' && (
                <div class="flow-line" role="status">
                  <span class="flow-dots" aria-hidden="true"><i /><i /><i /></span>
                  <span>Approve the {f.kind === 'withdraw' ? 'withdrawal' : 'deposit'} in your wallet.</span>
                </div>
              )}
              {f.phase === 'checking' && (
                <div class="flow-line" role="status">
                  <span class="flow-dots" aria-hidden="true"><i /><i /><i /></span>
                  <span>Checking on NEAR…</span>
                </div>
              )}
              {f.phase === 'done' && (
                <p class="px-sub px-good">
                  <Icon name="check" /> {f.kind === 'withdraw' ? 'Withdrawn to your wallet.' : f.kind === 'faucet' ? `Sent to your wallet. Deposit them above.` : 'Deposited.'}
                  {f.tx && <> <a class="px-link" href={txUrl(cfg, f.tx)} target="_blank" rel="noreferrer">View transaction <Icon name="link" /></a></>}
                </p>
              )}
              {f.phase === 'error' && <p class="px-sub px-bad flow-error"><Icon name="cross" /> {f.error}</p>}
              <div class="px-panel tight key-status">
                {enabled ? (
                  <p class="px-sub px-good"><Icon name="check" /> Coins enabled in this browser: plays and calls go without popups.</p>
                ) : (
                  <div class="px-row between">
                    <p class="px-sub">Playing coins needs one approval for this browser.</p>
                    <Button small kind="primary" onClick={p.onEnableCoins}><Icon name="bolt" /> Enable coins</Button>
                  </div>
                )}
              </div>
              <div class="px-row between">
                <Button kind={balance > 0 ? 'primary' : 'default'} disabled={busy} onClick={p.onDone}>{balance > 0 ? 'Back to the room' : 'Play free'}</Button>
                {p.gate && balance === 0 && <span class="px-dim" style={{ fontSize: '13px' }}>You can deposit any time: tap your coins at the top.</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
