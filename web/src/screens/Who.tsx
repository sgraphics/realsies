// "Who are you?" (test mode): the six test users idle on pedestals right under the top bar; tap one
// to play as them. First entry asks once, lightly: "I'm 18 or older and accept the terms".

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { World } from '../world/World.tsx';
import { useRigs } from '../ui/hooks.ts';
import { Icon } from '../ui/kit.tsx';
import { Hud } from '../ui/Hud.tsx';
import { NameTag } from '../ui/NameTag.tsx';
import type { SceneSeat } from '../../../art/src/scene/types.ts';
import { themeFor } from '../../../shared/protocol.ts';
import { acceptTerms, termsAccepted } from '../state/consent.ts';
import { agentsHref } from '../agents/route.ts';

export function WhoScreen({ store, onTerms }: { store: Store; onTerms(): void }) {
  const s = useStore(store);
  useEffect(() => {
    store.actions.loadTestUsers().catch(() => {});
  }, [store]);
  const users = s.testUsers ?? [];
  const rigs = useRigs(users.map((u) => u.seed));
  const seats: SceneSeat[] = useMemo(() => rigs.map((r) => ({ rig: r, look: 'idle' as const })), [rigs.map((r) => r?.seed).join()]);
  const theme = s.round ? themeFor(1, s.round.roundId) : 'castle';
  const busy = s.status === 'connecting';
  const [ok, setOk] = useState(termsAccepted);
  const [nudge, setNudge] = useState(0);
  const box = useRef<HTMLInputElement>(null);

  const pick = (accountId: string, i: number) => {
    if (!ok) {
      setNudge((n) => n + 1); // re-mounts the row so the nudge animation plays again
      setTimeout(() => box.current?.focus(), 0);
      return;
    }
    rigs[i]?.react('wave');
    store.actions.selectUser(accountId).catch(() => {});
  };

  const title = (
    <div class="who-title">
      <h1 class="px-title">Who are you?</h1>
      <p class="who-sub">Pick a test player.</p>
      <a class="px-link who-agents" href={agentsHref()} title="For AI builders: enter your agent, earn the Turing bonus, get the transcripts">
        <Icon name="bot" /> Run an AI? Enter it
      </a>
      {!ok && (
        <label key={nudge} class={'who-consent' + (nudge ? ' nudge' : '')}>
          <input
            ref={box}
            type="checkbox"
            onChange={(e) => {
              if ((e.target as HTMLInputElement).checked) {
                acceptTerms();
                setOk(true);
              }
            }}
          />
          <span class="who-check" aria-hidden="true"><Icon name="check" /></span>
          <span>I'm 18 or older and accept the <button type="button" class="px-link" onClick={(e) => { e.preventDefault(); onTerms(); }}>terms</button></span>
        </label>
      )}
    </div>
  );

  return (
    <>
      <Hud store={store} kind="who" title={title} onTerms={onTerms} />
      <World theme={theme} kind="hall" hallSeats={Math.max(1, users.length)} seats={seats}>
        {(w) => {
          const l = w.layout.kind === 'hall' ? w.layout : null;
          if (!l) return null;
          const roomy = l.content.h * w.scale.cssPx >= 96;
          return (
            <>
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
                      onClick={() => pick(u.accountId, i)}
                      onMouseEnter={() => rigs[i]?.react('nod')}
                    />
                    <NameTag
                      rect={slot.label}
                      cssPx={w.scale.cssPx}
                      name={u.label}
                      lines={2}
                      sub={<><Icon name="coin" />{u.balanceCoins}<Icon name="star" />{u.rating}</>}
                    />
                  </>
                );
              })}
              {!users.length && (
                <div style={w.box(l.inner)} class="world-center">
                  <div class="px-panel px-center world-note">Loading players…</div>
                </div>
              )}
              {users.length > 0 && roomy && (
                <div style={w.box(l.content)} class="world-top">
                  <div class="px-panel tight how-panel">
                    <p class="how-step"><b>1</b> Tap a character in the room</p>
                    <p class="how-step"><b>2</b> Chat for two minutes</p>
                    <p class="how-step"><b>3</b> Call it: real human?</p>
                    <p class="how-note">Everyone you meet is generated just for you.</p>
                  </div>
                </div>
              )}
            </>
          );
        }}
      </World>
    </>
  );
}
