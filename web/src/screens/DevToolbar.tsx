// Test-mode toolbar: round id and status, end chat now, end round now, contract link.

import { useEffect, useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { accountUrl, fmtClock } from '../state/format.ts';
import { Button, Icon } from '../ui/kit.tsx';

export function DevToolbar(p: { store: Store }) {
  const st = useStore(p.store);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(() => typeof window === 'undefined' || (window.innerWidth || 1024) > 760);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const cfg = st.config;
  if (!cfg?.testMode) return null;
  const r = st.round;
  const chatRunning = st.chat && (st.chat.phase === 'chatting' || st.chat.phase === 'placing');
  const endRound = async () => {
    setBusy(true);
    try {
      await p.store.actions.devEndRound();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class={'px-devbar' + (open ? '' : ' closed')} role="toolbar" aria-label="Test mode tools">
      <button type="button" class="px-devbar-toggle" onClick={() => setOpen(!open)} title={open ? 'Hide test tools' : 'Show test tools'}>
        DEV
      </button>
      {open && (
        <>
          <span class="px-mono px-small">
            {r ? `R${r.roundId} ${r.status} ${fmtClock(r.endsAt - Date.now())}` : 'no round'}
            {st.status !== 'open' && st.accountId ? ` · ${st.status}` : ''}
          </span>
          {chatRunning && (
            <Button small onClick={() => p.store.actions.devEndChat()}>
              End chat now
            </Button>
          )}
          {st.accountId && (
            <Button small kind="danger" disabled={busy} onClick={endRound}>
              {busy ? 'Ending…' : 'End round now'}
            </Button>
          )}
          <a class="px-link px-small" href={accountUrl(cfg, cfg.contractId)} target="_blank" rel="noreferrer">
            contract <Icon name="link" />
          </a>
        </>
      )}
    </div>
  );
}
