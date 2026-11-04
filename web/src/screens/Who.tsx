// "Who are you?" (test mode): the six test users idle on pedestals; tap one to play as them.

import { useEffect, useMemo } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { World } from '../world/World.tsx';
import { useRigs } from '../ui/hooks.ts';
import { Icon } from '../ui/kit.tsx';
import type { Rect, SceneSeat } from '../../../art/src/scene/types.ts';
import { themeFor } from '../../../shared/protocol.ts';

export function WhoScreen({ store }: { store: Store }) {
  const s = useStore(store);
  useEffect(() => {
    store.actions.loadTestUsers().catch(() => {});
  }, [store]);
  const users = s.testUsers ?? [];
  const rigs = useRigs(users.map((u) => u.seed));
  const seats: SceneSeat[] = useMemo(() => rigs.map((r) => ({ rig: r, look: 'idle' as const })), [rigs.map((r) => r?.seed).join()]);
  const theme = s.round ? themeFor(1, s.round.roundId) : 'castle';
  const busy = s.status === 'connecting';
  return (
    <World theme={theme} kind="hall" hallSeats={Math.max(1, users.length)} seats={seats}>
      {(w) => {
        const l = w.layout.kind === 'hall' ? w.layout : null;
        if (!l) return null;
        return (
          <>
            <div style={w.box((l as typeof l & { title?: Rect }).title ?? l.content)} class="px-col center">
              <div class="px-panel tight px-center sheet-enter" style={{ maxWidth: '100%' }}>
                <h1 class="px-title">Who are you?</h1>
                <p class="px-sub px-dim" style={{ marginTop: '6px' }}>Pick a test player. Everyone you meet is generated just for you.</p>
              </div>
            </div>
            {users.map((u, i) => {
              const slot = l.seats[i];
              if (!slot) return null;
              return (
                <>
                  <button
                    class="seat-hit"
                    style={w.box(slot.hit)}
                    aria-label={`Play as ${u.label}`}
                    disabled={busy}
                    onClick={() => {
                      rigs[i]?.react('wave');
                      store.actions.selectUser(u.accountId).catch(() => {});
                    }}
                    onMouseEnter={() => rigs[i]?.react('nod')}
                  />
                  <div class="seat-label" style={w.box({ ...slot.label, h: slot.label.h + 14 })}>
                    <span>
                      {u.label}
                      <span class="state" style={{ color: '#fff' }}>
                        <Icon name="coin" /> {u.balanceCoins} <Icon name="star" /> {u.rating}
                      </span>
                    </span>
                  </div>
                </>
              );
            })}
            {!users.length && (
              <div style={w.box(l.content)} class="px-col center">
                <div class="px-panel px-center">Loading players…</div>
              </div>
            )}
          </>
        );
      }}
    </World>
  );
}
