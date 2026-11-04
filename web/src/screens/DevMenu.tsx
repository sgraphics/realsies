// Test-mode tools inside the HUD menu: round id and status, end chat now, end round now, contract
// link. (Was a floating toolbar; on phones it covered the chat input, so it lives in the menu now.)

import { useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { accountUrl, fmtClock } from '../state/format.ts';
import { useNow } from '../ui/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';

export function DevMenu(p: { store: Store; onDone?: () => void }) {
  const st = useStore(p.store);
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const cfg = st.config;
  if (!cfg?.testMode) return null;
  const r = st.round;
  const chatRunning = st.chat && (st.chat.phase === 'chatting' || st.chat.phase === 'placing' || st.chat.phase === 'searching');
  const endRound = async () => {
    setBusy(true);
    try {
      await p.store.actions.devEndRound();
      p.onDone?.();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="dev-menu" aria-label="Test mode tools">
      <p class="dev-menu-head">
        <span class="hud-net">TEST</span>
        <span class="px-mono">
          {r ? `Round ${r.roundId} · ${r.status} · ${fmtClock(r.endsAt - now)}` : 'no round'}
          {st.status !== 'open' && st.accountId ? ` · ${st.status}` : ''}
        </span>
      </p>
      {chatRunning && (
        <Button small onClick={() => { p.store.actions.devEndChat(); p.onDone?.(); }}>
          <Icon name="clock" /> End chat now
        </Button>
      )}
      {st.accountId && (
        <Button small kind="danger" disabled={busy} onClick={endRound}>
          <Icon name="bolt" /> {busy ? 'Ending…' : 'End round now'}
        </Button>
      )}
      <a class="px-link dev-menu-link" href={accountUrl(cfg, cfg.contractId)} target="_blank" rel="noreferrer">
        Contract {cfg.contractId} <Icon name="link" />
      </a>
    </section>
  );
}
