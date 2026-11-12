// Lobby: the HUD (logo, level tabs and theme, round clock, coins, rating, called, Results, menu) over
// ten pedestals under an arch, each with its gamertag on a tag beneath. Tap a character -> seat dialog.
// A guest sees the same room (drawn for guests, state/guest.ts) with "Sign in" in the HUD; a tap asks to sign in.
// A first visitor must not have to guess what to do: over the room a guest reads "Tap anyone to chat", and that it is
// free with no wallet while a free try is left today (the HUD's button says "Play free" then).

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Level, Seat } from '../../../shared/protocol.ts';
import { themeFor } from '../../../shared/protocol.ts';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { fmtClock } from '../state/format.ts';
import { World } from '../world/World.tsx';
import { useNow, useRigs } from '../ui/hooks.ts';
import { Hud } from '../ui/Hud.tsx';
import { HINT_FREE, practiceOn, triedToday } from '../state/practice.ts';
import { NameTag } from '../ui/NameTag.tsx';
import type { IconName } from '../ui/kit.tsx';
import type { SceneSeat, SeatLook } from '../../../art/src/scene/types.ts';

export interface LobbyProps {
  store: Store;
  onSeat(level: Level, seat: Seat): void;
  onResults(roundId: number): void;
  onRounds(): void;
  onWallet(): void;
  onSwitchUser(): void;
  onSignOut?(): void;
  onTerms(): void;
  selectedSeat?: number | null;
  /** not signed in: watching the room */
  guest?: boolean;
  /** `wallet`: the menu's "Sign in to play", straight to the wallet */
  onSignIn?(wallet?: boolean): void;
  /** the auction banner's Get $REAL */
  onAuctionDeposit?(): void;
}

function seatLook(seat: Seat, selected: boolean): SeatLook {
  if (seat.state === 'unavailable') return 'empty';
  if (seat.state === 'called') return 'dim';
  if (selected || seat.state === 'searching' || seat.state === 'chatting') return 'selected';
  return 'idle';
}

function seatNote(seat: Seat): string | null {
  switch (seat.state) {
    case 'called': return seat.myCall === true ? 'you called human' : seat.myCall === false ? 'you called bot' : 'no call';
    case 'chatting': return 'chatting';
    case 'searching': return 'finding…';
    case 'unavailable': return 'away';
    default: return null;
  }
}

function seatIcon(seat: Seat): IconName | null {
  if (seat.state === 'called') return seat.myCall === true ? 'user' : seat.myCall === false ? 'bot' : 'cross';
  if (seat.state === 'chatting' || seat.state === 'searching') return 'chat';
  return null;
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

  const accepting = round ? now < round.acceptingUntil && round.status === 'open' : false;
  const roundLeft = round ? round.endsAt - now : 0;
  // a guest who still has a free practice chat today (v1.14)
  const freeTry = !!p.guest && practiceOn(s.config) && !triedToday(s.config?.practice?.perDay);

  return (
    <>
      <Hud store={store} kind="lobby" guest={p.guest} onSignIn={p.onSignIn} onAuctionDeposit={p.onAuctionDeposit} onResults={p.onResults} onRounds={p.onRounds} onWallet={p.onWallet} onSwitchUser={p.onSwitchUser} onSignOut={p.onSignOut} onTerms={p.onTerms} />
      <World theme={theme} kind="lobby" seats={sceneSeats}>
        {(w) => {
          const l = w.layout.kind === 'lobby' ? w.layout : null;
          if (!l) return null;
          return (
            <>
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
                      title={note ? `${seat.skin.name}: ${note}` : seat.skin.name}
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
                    <NameTag
                      rect={slot.label}
                      cssPx={w.scale.cssPx}
                      name={seat.state === 'unavailable' ? 'away' : seat.skin.name}
                      lines={l.label.lines}
                      icon={seatIcon(seat)}
                      tone={seat.state === 'called' || seat.state === 'unavailable' ? 'dim' : seat.state === 'chatting' || seat.state === 'searching' || p.selectedSeat === seat.index ? 'live' : 'normal'}
                    />
                  </>
                );
              })}

              {/* one slim line right under the HUD, above the first heads: over the arch it would cover characters */}
              {p.guest && room && accepting && !s.search && !s.chat && (
                <div style={w.box(l.inner)} class="world-top">
                  <p class="px-panel tight guest-hint">{freeTry ? HINT_FREE : 'Tap anyone to chat'}</p>
                </div>
              )}
              {round && !accepting && (
                <div style={w.box(l.arch)} class="world-center">
                  <div class="px-panel px-center sheet-enter world-note">
                    <p class="px-sub">This round is wrapping up.</p>
                    <p class="px-title">Next round in {fmtClock(roundLeft)}</p>
                  </div>
                </div>
              )}
              {!room && s.welcomed && (
                <div style={w.box(l.arch)} class="world-center">
                  <div class="px-panel tight world-note">Opening the room…</div>
                </div>
              )}
            </>
          );
        }}
      </World>
    </>
  );
}
