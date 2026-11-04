// Call: "Real human?" with the countdown in one panel, the partner big on a glowing pedestal with
// its gamertag beneath, big YES / NO, then "Locked until the round ends" with the round clock.

import { useEffect } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { fmtClock, txUrl } from '../state/format.ts';
import { World } from '../world/World.tsx';
import { useNow, useRig } from '../ui/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { Hud } from '../ui/Hud.tsx';
import { NameTag } from '../ui/NameTag.tsx';
import { themeFor } from '../../../shared/protocol.ts';

export function CallScreen({ store, onBack, onTerms }: { store: Store; onBack(): void; onTerms(): void }) {
  const s = useStore(store);
  const now = useNow(250);
  const chat = s.chat!;
  const cfg = s.config;
  const rig = useRig(chat.partner.seed);
  const theme = chat.theme ?? (s.round ? themeFor(chat.level, s.round.roundId) : 'castle');
  const deciding = chat.phase === 'calling';
  const left = chat.callDeadline ? Math.max(0, chat.callDeadline - now) : 0;
  const round = s.round;
  const roundLeft = round ? Math.max(0, round.endsAt - now) : 0;

  useEffect(() => {
    if (!rig) return;
    rig.lookToward(0);
    if (chat.phase === 'called') rig.react(chat.myCall ? 'nod' : 'shrug');
  }, [rig, chat.phase]);

  const call = (human: boolean) => {
    if (!deciding || chat.callPending) return;
    store.actions.call(human);
  };

  return (
    <>
      <Hud store={store} kind="call" onTerms={onTerms} />
      <World theme={theme} kind="call" partner={rig} locked={!deciding}>
        {(w) => {
          const l = w.layout.kind === 'call' ? w.layout : null;
          if (!l) return null;
          return (
            <>
              <NameTag rect={l.partner.label} cssPx={w.scale.cssPx} name={chat.partner.name} lines={l.label.lines} tone="live" />
              {deciding ? (
                <>
                  <div class="call-q-slot" style={w.box(l.question)}>
                    <div class="px-panel tight call-q sheet-enter">
                      <h1 class="px-big">Real human?</h1>
                      <p class={'call-count' + (left < 6000 ? ' low' : '')}>
                        <Icon name="clock" /> {fmtClock(left)} {chat.endedReason === 'partner_left' ? <span class="call-why">They left the chat. Make your call.</span> : <span class="call-why">to make your call</span>}
                      </p>
                    </div>
                  </div>
                  <div class="call-slot" style={w.box(l.yes)}>
                    <Button kind="good" class="huge" disabled={!!chat.callPending} onClick={() => call(true)}><Icon name="user" /> Yes</Button>
                  </div>
                  <div class="call-slot" style={w.box(l.no)}>
                    <Button kind="danger" class="huge" disabled={!!chat.callPending} onClick={() => call(false)}><Icon name="bot" /> No</Button>
                  </div>
                </>
              ) : (
                <div class="call-locked-slot" style={w.box(l.locked)}>
                  <div class="px-panel px-center sheet-enter call-locked">
                    {chat.phase === 'called' ? (
                      <>
                        <p class="px-sub px-dim">You called</p>
                        <p class="px-title">{chat.myCall ? 'Real human' : 'Bot'}</p>
                      </>
                    ) : (
                      <>
                        <p class="px-title">Time's up</p>
                        <p class="px-sub px-dim">{chat.mode === 'paid' ? 'No call: your coins count as a wrong call.' : 'No call this time.'}</p>
                      </>
                    )}
                    <p class="px-sub call-lock-line"><Icon name="lock" /> Locked until the round ends</p>
                    <p class="px-title"><Icon name="clock" /> {fmtClock(roundLeft)}</p>
                    {chat.callTx && (
                      <p class="px-sub"><a class="px-link" href={txUrl(cfg, chat.callTx)} target="_blank" rel="noreferrer">Call on chain <Icon name="link" /></a></p>
                    )}
                    <Button kind="primary" onClick={onBack}>Back to room</Button>
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
