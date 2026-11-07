// Coins for a wallet player, the same on testnet and mainnet: deposit (ft_transfer_call on the coin to the game
// contract) and withdraw (withdraw on the game contract) through the wallet, a "Buy REAL" link and the play key
// status. While the contract has no coin (mainnet before REAL launches): free play only. What the wallet itself
// holds is on screen, and a deposit it cannot cover is never offered: the reason sits where the button would act
// (an empty wallet, or too few coins for the amount). The one testnet difference: an empty wallet is offered
// the airdrop ("Airdrop 100 tREAL test tokens", protocol v1.6) where mainnet offers "Buy REAL".

import { useEffect, useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { useEscape } from '../ui/hooks.ts';
import { fmtCoins, txUrl } from '../state/format.ts';
import { depositCheck, emptyWalletText, fmtTokens, shortWalletText, symbolOf } from '../state/walletFunds.ts';
import { airdropOn, holdsEnough } from '../state/airdrop.ts';
import { AirdropButton } from '../ui/TestnetPanel.tsx';

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

export function WalletCoinsDialog(p: { store: Store; gate: boolean; onDone(): void; onEnableCoins(): void; prefill?: string }) {
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
  const enabled = p.store.actions.coinsEnabled();
  const perCoin = coinInTokens(cfg?.coinUnit, cfg?.tokenDecimals);
  const depN = Math.floor(Number(dep));
  const wdN = Math.floor(Number(wd));
  const info = s.walletInfo;
  const decimals = cfg?.tokenDecimals ?? 18;
  const chk = depositCheck(info, depN > 0 ? depN : 0, cfg?.coinUnit);
  const empty = chk.reason === 'empty';
  const short = depN > 0 && chk.reason === 'short';
  const drop = s.airdrop;
  const airdrop = airdropOn(cfg) && !holdsEnough(drop.status);
  const landed = drop.phase === 'done' && drop.landed?.to === 'wallet' ? drop.landed : undefined;
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
              {chk.walletUnits !== null && (
                <p class="px-sub wallet-hold">In your wallet: <b>{fmtTokens(chk.walletUnits, decimals)} {symbol}</b></p>
              )}
              <form class="custom-row" onSubmit={(e) => { e.preventDefault(); if (depN > 0 && !busy && chk.ok) void p.store.actions.walletDeposit(depN); }}>
                <input class="px-input" type="number" inputMode="numeric" min={1} placeholder="Coins" value={dep} onInput={(e) => setDep((e.target as HTMLInputElement).value)} aria-label="Coins to deposit" />
                <Button type="submit" kind={balance > 0 ? 'default' : 'primary'} disabled={busy || !(depN > 0) || !chk.ok}><Icon name="coin" /> Deposit from wallet</Button>
              </form>
              {empty && (
                <div class="px-row wallet-why" role="status">
                  <p class="px-sub">{emptyWalletText(symbol)}</p>
                  {airdropOn(cfg) ? (
                    airdrop && <AirdropButton store={p.store} small onLanded={afterAirdrop} />
                  ) : cfg?.buyUrl ? (
                    <a class="px-btn small primary buy-link" href={cfg.buyUrl} target="_blank" rel="noreferrer"><Icon name="coin" /> Buy {symbol} <Icon name="link" /></a>
                  ) : null}
                </div>
              )}
              {empty && airdropOn(cfg) && drop.phase === 'error' && drop.error && <p class="px-sub px-bad wallet-why" role="alert"><Icon name="cross" /> {drop.error.text}</p>}
              {short && <p class="px-sub wallet-why" role="status">{shortWalletText(symbol, chk.walletUnits!, decimals, chk.fits!)}</p>}
              {landed && (
                <p class="px-sub px-good" role="status">
                  <Icon name="check" /> {landed.coins} {symbol} airdropped to your wallet. Deposit them above.
                  {txUrl(cfg, landed.tx) && <> <a class="px-link" href={txUrl(cfg, landed.tx)} target="_blank" rel="noreferrer">View transaction <Icon name="link" /></a></>}
                </p>
              )}
              <p class="px-dim wallet-rate">
                {perCoin ? <>1 coin = {perCoin} {symbol}. </> : null}
                {cfg?.buyUrl && <a class="px-link" href={cfg.buyUrl} target="_blank" rel="noreferrer">Buy {symbol} <Icon name="link" /></a>}
              </p>
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
                  <Icon name="check" /> {f.kind === 'withdraw' ? 'Withdrawn to your wallet.' : 'Deposited.'}
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
