// Lobby: logo, level banner, tabs 1-3, stat pillar, ten pedestals under the arch.
// Tap a character -> seat dialog. Results button with a badge when a round has settled.

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Level, Seat } from '../../../shared/protocol.ts';
import { LEVELS, THEME_NAMES, themeFor } from '../../../shared/protocol.ts';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { fmtClock } from '../state/format.ts';
import { World } from '../world/World.tsx';
import { useNow, useRigs } from '../ui/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import type { Rect, SceneSeat, SeatLook } from '../../../art/src/scene/types.ts';

export interface LobbyProps {
  store: Store;
  onSeat(level: Level, seat: Seat): void;
  onResults(roundId: number): void;
  onRounds(): void;
  onWallet(): void;
  onSwitchUser(): void;
  selectedSeat?: number | null;
}

/** The pillar's text area stops above the action buttons when they share the column. */
function pillarBox(p: Rect, a: Rect): Rect {
  const overlapX = a.x < p.x + p.w && a.x + a.w > p.x;
  if (overlapX && a.y > p.y && a.y < p.y + p.h) return { ...p, h: a.y - p.y };
  return p;
}

function seatLook(seat: Seat, selected: boolean): SeatLook {
  if (seat.state === 'unavailable') return 'empty';
  if (seat.state === 'called') return 'dim';
  if (selected || seat.state === 'searching' || seat.state === 'chatting') return 'selected';
  return 'idle';
}

function seatNote(seat: Seat): string | null {
  switch (seat.state) {
    case 'called': return seat.myCall === true ? 'called: human' : seat.myCall === false ? 'called: bot' : 'no call';
    case 'chatting': return 'chatting';
    case 'searching': return 'finding…';
    case 'unavailable': return 'away';
    default: return null;
  }
}

export function LobbyScreen(p: LobbyProps) {
  const { store } = p;
  const s = useStore(store);
  const now = useNow(1000);
  const level = s.level;
  const room = s.rooms[level];
  const round = s.round;
  const theme = room?.theme ?? (round ? round.themes[level] ?? themeFor(level, round.roundId) : 'castle');
  const seatsData: Seat[] = room?.seats ?? [];
  const rigs = useRigs(seatsData.map((x) => (x.state === 'unavailable' ? null : x.skin.seed)));
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    // read the live state: a stale `level` from this render must not undo a newer enterRoom
    const st = store.get();
    if (st.welcomed && !st.rooms[st.level]) store.actions.enterRoom(st.level);
  }, [s.welcomed, level, room?.roundId, round?.roundId]);

  const sceneSeats: SceneSeat[] = useMemo(
    () => seatsData.map((seat, i) => ({ rig: rigs[i], look: seatLook(seat, p.selectedSeat === seat.index), hover: hover === i })),
    [seatsData, rigs.map((r) => r?.seed).join(), p.selectedSeat, hover],
  );

  const me = s.me;
  const cfg = s.config;
  const called = seatsData.filter((x) => x.state === 'called').length;
  const accepting = round ? now < round.acceptingUntil && round.status === 'open' : false;
  const roundLeft = round ? round.endsAt - now : 0;
  const unlocked = (L: Level) => !!cfg?.testMode || (me?.levelUnlocked ?? 1) >= L;
  const latestReady = s.resultsReady.length ? Math.max(...s.resultsReady) : null;

  return (
    <World theme={theme} kind="lobby" seats={sceneSeats}>
      {(w) => {
        const l = w.layout.kind === 'lobby' ? w.layout : null;
        if (!l) return null;
        const portrait = l.orientation === 'portrait';
        return (
          <>
            <div class="banner-text" style={w.box(l.banner)}>
              Level {level} · {THEME_NAMES[theme]}
            </div>
            <div class="tabs" style={w.box(l.tabs)} role="tablist" aria-label="Levels">
              {LEVELS.map((L) => (
                <Button
                  key={L}
                  small
                  kind={L === level ? 'primary' : 'default'}
                  disabled={!unlocked(L)}
                  title={unlocked(L) ? THEME_NAMES[round ? round.themes[L] ?? themeFor(L, round.roundId) : themeFor(L, 1)] : 'Raise your rating to unlock'}
                  onClick={() => store.actions.enterRoom(L)}
                >
                  {!unlocked(L) && <Icon name="lock" />}L{L}
                </Button>
              ))}
            </div>

            <div class={'pillar-text' + (portrait ? ' row' : '')} style={w.box(l.pillarText ?? pillarBox(l.pillar, l.actions))}>
              <div class="pillar-stat">
                <span class="k">{me && me.balanceCoins > 0 ? 'Coins' : 'Mode'}</span>
                <span class="v">{me && me.balanceCoins > 0 ? <><Icon name="coin" />{me.balanceCoins.toLocaleString('en-US')}</> : 'FREE'}</span>
              </div>
              {!!me?.lockedCoins && (
                <div class="pillar-stat">
                  <span class="k">On the table</span>
                  <span class="v"><Icon name="lock" />{me.lockedCoins.toLocaleString('en-US')}</span>
                </div>
              )}
              <div class="pillar-stat">
                <span class="k">Rating</span>
                <span class="v"><Icon name="star" />{me?.rating ?? '—'}</span>
              </div>
              <div class="pillar-stat">
                <span class="k">{accepting || !round ? 'Round ends' : 'Next round'}</span>
                <span class="v"><Icon name="clock" />{round ? fmtClock(roundLeft) : '—'}</span>
              </div>
              <div class="pillar-stat">
                <span class="k">Called</span>
                <span class="v">{called} of {seatsData.length || 10}</span>
              </div>
              {!portrait && (
                <Button small kind="primary" onClick={p.onWallet} title="Coins">
                  <Icon name="coin" /> {me && me.balanceCoins > 0 ? 'Coins' : 'Deposit'}
                </Button>
              )}
            </div>

            {seatsData.map((seat, i) => {
              const slot = l.seats[i];
              if (!slot) return null;
              const note = seatNote(seat);
              const canTap = seat.state === 'open' && accepting && !s.search && !s.chat;
              return (
                <>
                  <button
                    class="seat-hit"
                    style={w.box(slot.hit)}
                    aria-label={`${seat.skin.name}${note ? ', ' + note : ''}`}
                    disabled={!canTap}
                    onMouseEnter={() => {
                      setHover(i);
                      if (canTap) rigs[i]?.react('nod');
                    }}
                    onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                    onClick={() => {
                      rigs[i]?.react('wave');
                      p.onSeat(level, seat);
                    }}
                  />
                  <div class={'seat-label' + (seat.state === 'called' || seat.state === 'unavailable' ? ' dim' : '')} style={w.box(slot.label)}>
                    <span>
                      {seat.skin.name}
                      {note && <span class="state">{note}</span>}
                    </span>
                  </div>
                </>
              );
            })}

            <div class="actions" style={w.box(l.actions)}>
              {portrait && (
                <Button small kind="primary" onClick={p.onWallet}>
                  <Icon name="coin" />
                </Button>
              )}
              <Button small onClick={() => (latestReady ? p.onResults(latestReady) : p.onRounds())} title="Results">
                <Icon name="trophy" /> Results
                {s.resultsReady.length > 0 && <span class="px-badge">{s.resultsReady.length}</span>}
              </Button>
              <Button small onClick={p.onRounds} title="Past rounds">
                <Icon name="clock" />{portrait ? '' : ' Rounds'}
              </Button>
              <Button small kind="ghost" onClick={p.onSwitchUser} title="Switch player">
                <Icon name="user" />{portrait ? '' : ' ' + (me?.label ?? me?.accountId.split('.')[0] ?? '')}
              </Button>
            </div>

            {round && !accepting && (
              <div style={w.box(l.arch)} class="px-col center" >
                <div class="px-panel tight px-center" style={{ marginTop: 'auto', marginBottom: 'auto' }}>
                  <p class="px-sub">This round is wrapping up.</p>
                  <p class="px-title" style={{ marginTop: '6px' }}>Next round in {fmtClock(roundLeft)}</p>
                </div>
              </div>
            )}
            {!room && s.welcomed && (
              <div style={w.box(l.arch)} class="px-col center">
                <div class="px-panel tight" style={{ margin: 'auto' }}>Opening the room…</div>
              </div>
            )}
          </>
        );
      }}
    </World>
  );
}
