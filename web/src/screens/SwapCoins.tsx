// Coins for a wallet player when the relay buys and sells them on Rhea (protocol v1.12, PublicConfig.swap): the player
// only ever sees NEAR and coins. "Get coins": a NEAR amount (a quick one or one typed), a live line with the coins it
// gives, one button, one wallet approval (the play key, the registrations, the swap and the deposit ride together:
// state/store.ts swapBuy). "Withdraw": coins out of the game as NEAR, one approval too. Only while the wallet holds the
// coin itself (an airdrop, or a buy whose deposit did not follow): one line with "Put in the game" and "Swap to NEAR".
// One short honest line on the price. Without PublicConfig.swap the coins dialog is WalletCoins.tsx, unchanged.

import { useEffect, useState } from 'preact/hooks';
import type { SwapQuote } from '../../../shared/protocol.ts';
import type { Store } from '../state/store.ts';
import { nearShortText } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { useEscape } from '../ui/hooks.ts';
import { fmtCoins, txUrl } from '../state/format.ts';
import { emptyWalletText, fmtTokens, symbolOf } from '../state/walletFunds.ts';
import { coinValue, fmtNear, parseNear } from '../state/near.ts';
import { airdropOn, holdsEnough } from '../state/airdrop.ts';
import { AirdropButton } from '../ui/TestnetPanel.tsx';
import { buyNearNeeded, swapWalletOf } from '../wallet/swap.ts';

/** The quick amounts, in NEAR (about 100, 200, 400 and 800 coins at 400 coins per NEAR). */
export const QUICK_NEAR = ['0.25', '0.5', '1', '2'];
const MIN_YOCTO = 10n ** 21n;
const QUOTE_WAIT_MS = 250;

export const SWAP_FIRST = 'One wallet approval. After that, plays run without popups.';

/** The honest line: what coins are, where they trade, and that the price moves. */
export function swapFineText(symbol: string): string {
  return `Coins are $${symbol}, bought and sold on Rhea at the current price. The price moves.`;
}

type Quoted = { key: string; q?: SwapQuote; err?: string };

/** The relay's quote for what is typed, a moment after the typing stops; `key` says which amount it answers. */
function useQuote(store: Store, ask: { side: 'buy'; near: string } | { side: 'sell'; units: string } | null): Quoted | null {
  const [got, setGot] = useState<Quoted | null>(null);
  const key = ask ? `${ask.side}:${'near' in ask ? ask.near : ask.units}` : '';
  useEffect(() => {
    if (!ask) {
      setGot(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      store.actions.swapQuote(ask).then(
        (q) => live && setGot({ key, q }),
        (e: Error) => live && setGot({ key, err: e.message }),
      );
    }, QUOTE_WAIT_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]);
  return got && got.key === key ? got : null;
}

export function SwapCoinsDialog(p: { store: Store; gate: boolean; onDone(): void; prefill?: string; near?: string; withdraw?: string }) {
  const s = useStore(p.store);
  const me = s.me;
  const cfg = s.config;
  const f = s.walletTx;
  const [near, setNear] = useState(p.near ?? '');
  const [wd, setWd] = useState(p.withdraw ?? '');
  const busy = f.phase === 'wallet' || f.phase === 'checking';
  useEscape(() => !busy && p.onDone());
  useEffect(() => {
    void p.store.actions.refreshWalletInfo();
    void p.store.actions.refreshAirdrop();
    return () => p.store.actions.resetFlow('walletTx');
  }, [p.store]);
  // amounts handed in while the dialog is already open (it may have opened on its own as the deposit gate)
  useEffect(() => {
    if (p.near) setNear(p.near);
  }, [p.near]);
  useEffect(() => {
    if (p.withdraw) setWd(p.withdraw);
  }, [p.withdraw]);
  // opened for a number of coins (a play needs them): the NEAR that surely buys them
  useEffect(() => {
    const n = Math.floor(Number(p.prefill));
    if (!(n > 0)) return;
    p.store.actions.swapQuote({ side: 'buy', coins: n }).then(
      (q) => setNear((cur) => (cur === '' ? fmtNear(BigInt(q.amountIn), 3) : cur)),
      () => {},
    );
  }, [p.prefill]);

  const balance = me?.balanceCoins ?? 0;
  const symbol = symbolOf(cfg);
  const decimals = cfg?.tokenDecimals ?? 18;
  const unit = BigInt(cfg?.coinUnit ?? '1000000000000000000');
  const info = s.walletInfo;
  const wal = swapWalletOf(info);
  const walletUnits = info?.walletBalance !== undefined ? BigInt(info.walletBalance) : 0n;
  const walletCoins = Number(walletUnits / unit);
  const keyed = p.store.actions.coinsEnabled();

  // ----- get coins -----
  const yocto = parseNear(near);
  const buyAsk = yocto !== null && yocto >= MIN_YOCTO ? { side: 'buy' as const, near: yocto.toString() } : null;
  const buyQ = useQuote(p.store, buyAsk);
  const need = yocto !== null && wal ? buyNearNeeded(yocto, wal) : null;
  const short = need !== null && wal?.near != null && need > wal.near;
  const coinsOut = buyQ?.q?.coins ?? 0;
  const canBuy = !busy && !!buyAsk && coinsOut >= 1 && !short;
  const buyLine = !buyAsk
    ? near.trim() && yocto !== null
      ? 'That is less than one coin.'
      : null
    : short
      ? nearShortText(need!, wal!.near!)
      : !buyQ
        ? '…'
        : buyQ.err
          ? buyQ.err
          : coinsOut < 1
            ? 'That is less than one coin.'
            : `You get ${coinsOut.toLocaleString('en-US')} coin${coinsOut === 1 ? '' : 's'}.`;

  // ----- withdraw as NEAR -----
  const wdN = Math.floor(Number(wd));
  const wdOk = wdN > 0 && wdN <= balance + 1e-9;
  const sellQ = useQuote(p.store, wdOk ? { side: 'sell', units: (BigInt(wdN) * unit).toString() } : null);
  const sellLine = !wd.trim() ? null : !wdOk ? (wdN > balance ? `You have ${fmtCoins(balance)} coins in the game.` : null) : !sellQ ? '…' : sellQ.err ? sellQ.err : `About ${fmtNear(BigInt(sellQ.q!.amountOut), 4)} NEAR.`;

  // testnet: an empty wallet still gets the airdrop, as before
  const testnet = airdropOn(cfg);
  const airdrop = testnet && info?.walletBalance !== undefined && walletUnits === 0n && !holdsEnough(s.airdrop.status);
  const drop = s.airdrop;

  const buy = () => {
    if (!canBuy || yocto === null) return;
    void p.store.actions.swapBuy(yocto).then((ok) => ok && setNear(''));
  };
  const sell = () => {
    if (!wdOk || busy) return;
    void p.store.actions.swapSell(wdN).then((ok) => ok && setWd(''));
  };

  const done = f.phase === 'done';
  const doneText =
    f.kind === 'buy'
      ? f.left
        ? `Bought ${fmtCoins(f.coins ?? 0)} coins. They are in your wallet: put them in the game.`
        : `Got ${fmtCoins(f.coins ?? 0)} coins.`
      : f.kind === 'sell'
        ? f.left
          ? `${fmtCoins(f.coins ?? 0)} coins are in your wallet; the sale did not go through. Swap them to NEAR.`
          : `Withdrew ${fmtCoins(f.coins ?? 0)} coins as about ${fmtNear(BigInt(f.near ?? '0'), 4)} NEAR.`
        : f.kind === 'withdraw'
          ? 'Withdrawn to your wallet.'
          : 'Your coins are in the game.';

  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && !busy && p.onDone()}>
      <div class="modal narrow px-panel sheet-enter wallet-dialog swap-dialog" role="dialog" aria-modal="true" aria-label={balance > 0 ? 'Your coins' : 'Get coins'}>
        <div class="px-col">
          <h2 class="px-title"><Icon name="coin" /> {balance > 0 ? 'Your coins' : 'Get coins'}</h2>
          {(balance > 0 || !!me?.lockedCoins) && (
            <p class="px-sub wallet-hold">
              In the game: <b>{fmtCoins(balance)} coins</b>{balance > 0 ? <> (about {coinValue(cfg, balance)})</> : null}{me?.lockedCoins ? <>, {fmtCoins(me.lockedCoins)} on the table</> : null}
            </p>
          )}
          {walletUnits > 0n && (
            <div class={'px-row wallet-why swap-held' + (done && f.left ? ' on' : '')} role="status">
              <p class="px-sub">In your wallet: <b>{fmtTokens(walletUnits, decimals)} {symbol}</b></p>
              <div class="swap-held-btns">
                <Button small kind="primary" disabled={busy || walletCoins < 1} onClick={() => void p.store.actions.walletDeposit(walletCoins)}>Put in the game</Button>
                <Button small disabled={busy} onClick={() => void p.store.actions.swapSell(0, 'wallet')}>Swap to NEAR</Button>
              </div>
            </div>
          )}
          {!!me?.lockedBonusCoins && <p class="px-sub wallet-hold"><Icon name="lock" /> {fmtCoins(me.lockedBonusCoins)} bonus coins unlock with your next deposit.</p>}

          <form class="swap-buy" onSubmit={(e) => { e.preventDefault(); buy(); }}>
            <div class="swap-amounts" role="group" aria-label="NEAR to pay">
              {QUICK_NEAR.map((a) => (
                <Button key={a} kind={near === a ? 'primary' : 'default'} class="preset" disabled={busy} onClick={() => setNear(a)} title={`${a} NEAR`}>
                  <span>{a}</span>
                  <span class="usd">NEAR</span>
                </Button>
              ))}
            </div>
            <div class="custom-row">
              <input class="px-input" type="text" inputMode="decimal" autoComplete="off" placeholder="NEAR" value={near} onInput={(e) => setNear((e.target as HTMLInputElement).value)} aria-label="NEAR to pay" />
              <Button type="submit" kind="primary" disabled={!canBuy}><Icon name="coin" /> Get coins</Button>
            </div>
          </form>
          {buyLine && <p class={'swap-line' + (short ? ' px-bad' : '')} role="status">{buyLine}</p>}
          {!keyed && <p class="px-dim wallet-note">{SWAP_FIRST}</p>}
          {airdrop && (
            <div class="px-row wallet-why" role="status">
              <p class="px-sub">{emptyWalletText(symbol)}</p>
              <AirdropButton store={p.store} small />
            </div>
          )}
          {airdrop && drop.phase === 'error' && drop.error && <p class="px-sub px-bad wallet-why" role="alert"><Icon name="cross" /> {drop.error.text}</p>}

          {balance > 0 && (
            <>
              <form class="custom-row" onSubmit={(e) => { e.preventDefault(); sell(); }}>
                <input class="px-input" type="number" inputMode="numeric" min={1} max={Math.floor(balance)} placeholder="Coins" value={wd} onInput={(e) => setWd((e.target as HTMLInputElement).value)} aria-label="Coins to withdraw as NEAR" />
                <Button type="submit" disabled={busy || !wdOk}>Withdraw</Button>
              </form>
              {sellLine && <p class="swap-line" role="status">{sellLine}</p>}
            </>
          )}

          <p class="px-dim swap-fine">{swapFineText(symbol)}</p>

          {busy && (
            <div class="flow-line" role="status">
              <span class="flow-dots" aria-hidden="true"><i /><i /><i /></span>
              <span>{f.phase === 'wallet' ? 'Approve in your wallet.' : 'Checking on NEAR…'}</span>
            </div>
          )}
          {done && (
            <p class={'px-sub flow-error ' + (f.left ? 'swap-note' : 'px-good')} role="status">
              <Icon name={f.left ? 'coin' : 'check'} /> {doneText}
              {f.tx && <> <a class="px-link" href={txUrl(cfg, f.tx)} target="_blank" rel="noreferrer">View transaction <Icon name="link" /></a></>}
            </p>
          )}
          {f.phase === 'error' && <p class="px-sub px-bad flow-error" role="alert"><Icon name="cross" /> {f.error}</p>}
          <div class="px-row between">
            <Button kind={balance > 0 ? 'primary' : 'default'} disabled={busy} onClick={p.onDone}>{balance > 0 ? 'Back to the room' : 'Play free'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
