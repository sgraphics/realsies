// "Deposit into the $REAL auction", from realsies.lol (a fallback while meme.cooking's own page fails): the amount
// in NEAR, what the wallet holds, the auction at a glance (refreshed every 30 s), a plain warning and one Deposit
// button, one wallet approval for the whole batch (auction.ts). Then "Deposited N NEAR" with the transaction.
// Opened from the auction banner's Get $REAL; mainnet only, while the auction runs; a guest signs in first.

import { useEffect, useState } from 'preact/hooks';
import type { AuctionInfo } from '../../../shared/protocol.ts';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { useEscape, useNow } from '../ui/hooks.ts';
import { txUrl } from '../state/format.ts';
import { sendSteps, type Step } from '../wallet/batch.ts';
import { tokenUrlOf } from './phase.ts';
import {
  MIN_DEPOSIT, auctionDepositTxs, auctionLine, fmtNear, nearNeeded, parseNear, rpcViews, type AuctionAccount, type AuctionViews,
} from './auction.ts';

export const AUCTION_WARNING = 'You receive REAL after the auction finalizes; if the 100 NEAR soft cap is not reached, you withdraw your deposit on meme.cooking. 0.5% fee.';

/** The account's chain state: the public mainnet RPC, or the mock chain in ?mock=1. */
function viewsOf(store: Store): AuctionViews {
  return (store.client as { auctionViews?: AuctionViews }).auctionViews ?? rpcViews();
}

export function AuctionDepositDialog(p: { store: Store; onClose(): void; amount?: string }) {
  const s = useStore(p.store);
  const cfg = s.config;
  const account = s.session?.accountId;
  const now = useNow(15_000);
  const [amount, setAmount] = useState(p.amount ?? '1');
  const [info, setInfo] = useState<AuctionInfo | null>(null);
  const [acct, setAcct] = useState<AuctionAccount | null>(null);
  const [flow, setFlow] = useState<{ phase: 'idle' | 'wallet' | 'done' | 'error'; tx?: string; amount?: bigint; error?: string }>({ phase: 'idle' });
  const views = viewsOf(p.store);
  const busy = flow.phase === 'wallet';
  useEscape(() => !busy && p.onClose());
  const loadInfo = () => void p.store.client.auctionInfo?.().then(setInfo, () => {});
  const loadAcct = () => (account ? views.account(account).then(setAcct, () => setAcct(null)) : Promise.resolve());
  useEffect(() => {
    loadInfo();
    void loadAcct();
    const t = setInterval(loadInfo, 30_000);
    return () => clearInterval(t);
  }, [account]);

  const yocto = parseNear(amount);
  const tooSmall = yocto !== null && yocto < MIN_DEPOSIT;
  const need = yocto !== null && acct ? nearNeeded(yocto, acct) : null;
  const short = need !== null && !!acct && need > acct.near;
  const ready = !!account && !!acct && yocto !== null && !tooSmall && !short && !busy;
  const token = tokenUrlOf(cfg);

  const deposit = async () => {
    if (!ready || !account || !acct || yocto === null || !p.store.wallet) return;
    const w = p.store.wallet;
    const txs = auctionDepositTxs(account, yocto, acct);
    // after a batch the wallet refused, each step is sent alone, and only if it did not land meanwhile
    const fresh = () => views.account(account);
    const steps: Step[] = txs.map((tx) => {
      const a = tx.actions[0];
      const m = a.type === 'FunctionCall' ? a.params.methodName : '';
      if (m === 'storage_deposit' && tx.receiverId === 'meme-cooking.near') return { tx, landed: async () => (await fresh()).memeRegistered };
      if (m === 'storage_deposit') return { tx, landed: async () => (await fresh()).wrapRegistered };
      if (m === 'near_deposit') return { tx, landed: async () => (await fresh()).wnear >= yocto };
      return { tx };
    });
    setFlow({ phase: 'wallet' });
    try {
      const { hashes } = await sendSteps(w, account, steps);
      setFlow({ phase: 'done', tx: hashes[hashes.length - 1] ?? undefined, amount: yocto });
    } catch (e) {
      setFlow({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
    loadInfo();
    void loadAcct();
  };

  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && !busy && p.onClose()}>
      <div class="modal narrow px-panel sheet-enter wallet-dialog auction-dialog" role="dialog" aria-modal="true" aria-labelledby="auction-title">
        <div class="px-col">
          <div class="px-row px-head">
            <h2 id="auction-title" class="px-title"><Icon name="coin" /> Deposit into the $REAL auction</h2>
            <Button small kind="ghost" disabled={busy} onClick={p.onClose}>Back</Button>
          </div>
          <p class="px-sub wallet-hold auction-line" role="status">{info ? auctionLine(info, now) : 'Auction: reading meme.cooking…'}</p>
          <p class="px-sub wallet-hold">
            In your wallet: <b>{acct ? `${fmtNear(acct.near)} NEAR` : '…'}</b>
            {acct && acct.wnear > 0n ? <> and <b>{fmtNear(acct.wnear)} wNEAR</b></> : null}
          </p>
          <form class="custom-row" onSubmit={(e) => { e.preventDefault(); void deposit(); }}>
            <input class="px-input" type="number" inputMode="decimal" min={0.1} step={0.1} placeholder="NEAR" value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} aria-label="NEAR to deposit" />
            <Button type="submit" kind="primary" disabled={!ready}><Icon name="coin" /> {busy ? 'Approve in your wallet…' : 'Deposit'}</Button>
          </form>
          {tooSmall && <p class="px-sub wallet-why" role="status">The smallest deposit is 0.1 NEAR.</p>}
          {short && need !== null && <p class="px-sub wallet-why" role="status">That needs {fmtNear(need)} NEAR with the fees and storage; your wallet has {fmtNear(acct!.near)}.</p>}
          <p class="px-dim auction-warn">{AUCTION_WARNING}</p>
          {flow.phase === 'done' && flow.amount !== undefined && (
            <p class="px-sub px-good" role="status">
              <Icon name="check" /> Deposited {fmtNear(flow.amount)} NEAR.
              {flow.tx && <> <a class="px-link" href={txUrl(cfg, flow.tx)} target="_blank" rel="noreferrer">View transaction <Icon name="link" /></a></>}
            </p>
          )}
          {flow.phase === 'error' && <p class="px-sub px-bad flow-error"><Icon name="cross" /> {flow.error}</p>}
          {token && (
            <p class="px-dim auction-alt">
              <a class="px-link" href={token} target="_blank" rel="noopener">or on meme.cooking <Icon name="link" /></a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
