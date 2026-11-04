// Call: "Real human?" with big YES / NO and a countdown, then "Locked until the round ends".

import { useEffect } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { fmtClock, txUrl } from '../state/format.ts';
import { World } from '../world/World.tsx';
import { useNow, useRig } from '../ui/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { themeFor } from '../../../shared/protocol.ts';
import type { Rect } from '../../../art/src/scene/types.ts';

/** The locked panel sits below the partner (buttons + timer area), never over the face. */
function lockedBox(l: { buttons: Rect; timer: Rect; inner: Rect }): Rect {
  const y = l.buttons.y;
  const bottom = Math.max(l.buttons.y + l.buttons.h, l.timer.y + l.timer.h);
  const x = Math.min(l.buttons.x, l.timer.x);
  const w = Math.max(l.buttons.x + l.buttons.w, l.timer.x + l.timer.w) - x;
  return { x, y, w, h: Math.max(bottom, l.inner.y + l.inner.h) - y };
}

export function CallScreen({ store, onBack }: { store: Store; onBack(): void }) {
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
    <World theme={theme} kind="call" partner={rig}>
      {(w) => {
        const l = w.layout.kind === 'call' ? w.layout : null;
        if (!l) return null;
        return (
          <>
            <div class="seat-label" style={w.box(l.partner.label)}>
              <span>{chat.partner.name}</span>
            </div>
            {deciding ? (
              <>
                <div class="call-q" style={w.box(l.question)}>
                  <h1 class="px-big">Real human?</h1>
                  {chat.endedReason === 'partner_left' && <p class="px-sub">They left the chat. Make your call.</p>}
                </div>
                {(() => {
                  const yes = (l as typeof l & { yes?: Rect }).yes, no = (l as typeof l & { no?: Rect }).no;
                  const yesB = <Button kind="good" class="huge" disabled={!!chat.callPending} onClick={() => call(true)}><Icon name="user" /> Yes</Button>;
                  const noB = <Button kind="danger" class="huge" disabled={!!chat.callPending} onClick={() => call(false)}><Icon name="bot" /> No</Button>;
                  if (yes && no)
                    return (
                      <>
                        <div class="call-slot" style={w.box(yes)}>{yesB}</div>
                        <div class="call-slot" style={w.box(no)}>{noB}</div>
                      </>
                    );
                  return <div class="call-buttons" style={w.box(l.buttons)}>{yesB}{noB}</div>;
                })()}
                <div class={'timer-text' + (left < 6000 ? ' low' : '')} style={w.box(l.timer)}>
                  <Icon name="clock" /> {fmtClock(left)}
                </div>
              </>
            ) : (
              <div class="call-q" style={w.box(lockedBox(l))}>
                <div class="px-panel px-center sheet-enter" style={{ pointerEvents: 'auto', maxWidth: '100%', marginTop: 'auto', marginBottom: 'auto' }}>
                  {chat.phase === 'called' ? (
                    <>
                      <p class="px-sub px-dim">You called</p>
                      <p class="px-title" style={{ margin: '6px 0' }}>{chat.myCall ? 'Real human' : 'Bot'}</p>
                    </>
                  ) : (
                    <>
                      <p class="px-title" style={{ marginBottom: '6px' }}>Time's up</p>
                      <p class="px-sub px-dim">{chat.mode === 'paid' ? 'No call: your coins count as a wrong call.' : 'No call this time.'}</p>
                    </>
                  )}
                  <p class="px-sub" style={{ marginTop: '10px' }}><Icon name="lock" /> Locked until the round ends</p>
                  <p class="px-title" style={{ margin: '6px 0 10px' }}><Icon name="clock" /> {fmtClock(roundLeft)}</p>
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
  );
}
