// Past rounds: every round newest first, with its settle transaction and a way into its results.

import { useEffect, useState } from 'preact/hooks';
import type { RoundSummary } from '../../../shared/protocol.ts';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { fmtDateTime, shortHash, txUrl } from '../state/format.ts';
import { Button, Icon, Panel } from '../ui/kit.tsx';

export interface PastRoundsProps {
  store: Store;
  onOpenResults(roundId: number): void;
  onClose(): void;
}

const STATUS: Record<RoundSummary['status'], string> = { open: 'Open', closing: 'Closing', settling: 'Settling', settled: 'Settled' };

export function PastRounds(p: PastRoundsProps) {
  const st = useStore(p.store);
  const [rounds, setRounds] = useState<RoundSummary[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    p.store.actions
      .listRounds()
      .then((r) => live && setRounds(r))
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [p.store, st.resultsReady.length, st.round?.roundId]);

  return (
    <Panel class="px-rounds">
      <div class="px-row px-head">
        <h2 class="px-title">Past rounds</h2>
        <Button small kind="ghost" onClick={p.onClose}>
          Back
        </Button>
      </div>
      {err && <p class="px-error">{err}</p>}
      {!rounds && !err && <p class="px-dim">Loading…</p>}
      {rounds && (
        <ul class="px-rounds-list">
          {rounds.map((r) => {
            const ready = st.resultsReady.includes(r.roundId);
            return (
              <li key={r.roundId} class={'px-round-row ' + r.status}>
                <div class="px-col">
                  <div class="px-row px-wrap">
                    <b>Round {r.roundId}</b>
                    <span class={'px-tag ' + r.status}>{STATUS[r.status]}</span>
                    {ready && <span class="px-badge new">new results</span>}
                  </div>
                  <div class="px-row px-wrap px-small px-dim">
                    <span>{fmtDateTime(r.startedAt)}</span>
                    <span>{r.characters} characters</span>
                    <span>{r.chats} chats</span>
                    <span>{r.paidPlays} paid plays</span>
                    {r.settleTx && (
                      <a class="px-link" href={txUrl(st.config, r.settleTx)} target="_blank" rel="noreferrer">
                        settle {shortHash(r.settleTx, 4)} <Icon name="link" />
                      </a>
                    )}
                  </div>
                </div>
                {r.status === 'settled' && (
                  <Button small kind={ready ? 'primary' : 'default'} onClick={() => p.onOpenResults(r.roundId)}>
                    Results
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
