// The TESTNET panel (protocol v1.6), on the testnet demo only (test mode on testnet): the first row of the HUD,
// so the HUD measures it and the world (the chat input included) lays out under it. In the room it offers one big
// button, "Airdrop 100 tREAL test tokens", and says no further action is needed; once the tokens land it says
// where they are and that from here it works like the real game, then folds into a slim TESTNET tag, which offers
// "Airdrop again" only while the account holds little. A refusal (too soon, enough held) shows its reason here.
// In a chat or a call only the slim tag shows, and in a chat on a phone not even that.

import { useEffect } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { symbolOf } from '../state/walletFunds.ts';
import { txUrl } from '../state/format.ts';
import {
  TESTNET_LINE, airdropLabel, airdropOn, airdropRefused, beforeNote, landedNext, landedText, offerAgain, panelMode,
} from '../state/airdrop.ts';
import { Button, Icon } from './kit.tsx';

/** A phone, or a screen too short to give a chat any less room (as the launch banner). */
function cramped(): boolean {
  return typeof window !== 'undefined' && (window.innerWidth < 700 || window.innerHeight < 600);
}

/** QA screenshots hold the message on screen (no folding on a timer). */
const QA = typeof location !== 'undefined' && /[?&]mock=1/.test(location.search) && /[?&]qa=/.test(location.search);

/** How long the "they landed" message stays before the panel folds into its tag. */
const FOLD_MS = 20_000;

export function TestnetPanel(p: { store: Store; kind: 'lobby' | 'chat' | 'call' | 'who' }) {
  const { store, kind } = p;
  const s = useStore(store);
  const cfg = s.config;
  const on = airdropOn(cfg) && !!s.accountId && kind !== 'who';
  const a = s.airdrop;

  // the relay's view: when the player arrives, and again when their coins move (a round settled, a deposit)
  const balance = s.me ? Math.round(s.me.balanceCoins * 100) : null;
  useEffect(() => {
    if (!on || !s.welcomed) return;
    if (store.get().airdrop.status === undefined) {
      void store.actions.refreshAirdrop();
      return;
    }
    const t = setTimeout(() => void store.actions.refreshAirdrop(), 1200);
    return () => clearTimeout(t);
  }, [on, s.accountId, s.welcomed, balance]);

  // the message folds into the tag on its own after a while
  useEffect(() => {
    if (a.phase !== 'done' || QA) return;
    const t = setTimeout(() => store.actions.foldAirdrop(), FOLD_MS);
    return () => clearTimeout(t);
  }, [a.phase, a.landed?.tx]);

  if (!on) return null;
  if (kind === 'chat' && cramped()) return null;
  const mode = panelMode(s, kind);
  if (mode === 'none') return null;
  const symbol = symbolOf(cfg);
  const to = a.landed?.to ?? a.status?.to ?? (s.session?.accountId === s.accountId ? 'wallet' : 'game');
  const go = () => void store.actions.airdrop();
  const fold = () => store.actions.foldAirdrop();
  const badge = <span class="hud-tn-badge">TESTNET</span>;
  const x = (
    <button type="button" class="hud-tn-x" title="Fold" aria-label="Fold the testnet panel" onClick={fold}>×</button>
  );

  if (mode === 'tag') {
    const again = offerAgain(a.status);
    return (
      <div class="hud-tn tag" role="status" aria-label="Testnet">
        {badge}
        <span class="hud-tn-t">{TESTNET_LINE}</span>
        {again && kind === 'lobby' && (
          <button type="button" class="hud-tn-link" onClick={go}>Airdrop again</button>
        )}
      </div>
    );
  }

  if (mode === 'done' && a.landed) {
    const url = txUrl(cfg, a.landed.tx);
    return (
      <div class="hud-tn done" role="status" aria-label="Testnet">
        <div class="hud-tn-head">
          {badge}
          <span class="hud-tn-t"><Icon name="check" /> {landedText(a.landed.to, a.landed.coins, symbol)}</span>
          {x}
        </div>
        <div class="hud-tn-row">
          <span class="hud-tn-note">{landedNext(a.landed.to)}</span>
          {url && <a class="hud-tn-link" href={url} target="_blank" rel="noreferrer">View transaction</a>}
          <button type="button" class="hud-tn-ok" onClick={fold}>OK</button>
        </div>
      </div>
    );
  }

  // the offer, the moment it runs, and a reason when it did not happen
  const busy = mode === 'busy';
  const err = mode === 'error' ? a.error : undefined;
  const refused = airdropRefused(err?.code);
  return (
    <div class={'hud-tn' + (err ? ' err' : '')} role="region" aria-label="Testnet">
      <div class="hud-tn-head">
        {badge}
        <span class="hud-tn-t"><span class="hud-tn-sep">·</span> {TESTNET_LINE}</span>
        {x}
      </div>
      <div class="hud-tn-row">
        {!refused && (
          <button type="button" class="hud-tn-cta" disabled={busy} aria-busy={busy} onClick={go}>
            <Icon name="coin" /> {busy ? 'Airdropping…' : err ? 'Try again' : airdropLabel(symbol)}
          </button>
        )}
        {err ? (
          <span class="hud-tn-note" role="alert"><Icon name="cross" /> {err.text}</span>
        ) : (
          <span class="hud-tn-note">{busy ? (to === 'wallet' ? 'Sending them to your wallet…' : 'Sending them to your game balance…') : beforeNote(to)}</span>
        )}
      </div>
    </div>
  );
}

/**
 * The same airdrop as a button in the coins screens (testnet only); the outcome shows where the button was.
 * `onLanded`: what the screen does next (the deposit field holds what just arrived).
 */
export function AirdropButton(p: { store: Store; small?: boolean; onLanded?(): void }) {
  const s = useStore(p.store);
  const a = s.airdrop;
  const busy = a.phase === 'busy';
  return (
    <Button
      small={p.small}
      kind="primary"
      disabled={busy}
      onClick={async () => {
        if (await p.store.actions.airdrop()) p.onLanded?.();
      }}
    >
      <Icon name="coin" /> {busy ? 'Airdropping…' : airdropLabel(symbolOf(s.config))}
    </Button>
  );
}
