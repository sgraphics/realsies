// The HUD: one bar across the top that holds every piece of game information in bordered pixel
// panels: the logo with a small TESTNET marker, level tabs with the theme name, the round clock,
// coins and locked coins, rating, "x of 10 called", Results with its badge, and a menu (coins,
// past rounds, terms, switch player, test tools). One line on wide screens and phones held
// sideways, two lines on phones and tablets. The world lays itself out under it (hudSize.ts).

import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Level } from '../../../shared/protocol.ts';
import { LEVELS, THEME_NAMES, themeFor } from '../../../shared/protocol.ts';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { fmtClock, fmtCoins } from '../state/format.ts';
import { isCounting } from '../state/countdown.ts';
import { useEscape, useNow } from './hooks.ts';
import { Icon, type IconName } from './kit.tsx';
import { Logo } from './Logo.tsx';
import { setHudHeight } from './hudSize.ts';
import { DevMenu } from '../screens/DevMenu.tsx';
import { agentsHref } from '../agents/route.ts';
import { LaunchBanner } from './LaunchBanner.tsx';

export type HudKind = 'lobby' | 'chat' | 'call' | 'who';

export interface HudProps {
  store: Store;
  kind: HudKind;
  onResults?(roundId: number): void;
  onRounds?(): void;
  onWallet?(): void;
  onSwitchUser?(): void;
  /** wallet players: sign out (the session ends, this browser forgets its play key) */
  onSignOut?(): void;
  onTerms?(): void;
  /** who: the title panel content. */
  title?: ComponentChildren;
}

function Stat(p: { area: string; icon: IconName; k: string; v: ComponentChildren; sub?: ComponentChildren; title?: string; tone?: string; onClick?: () => void }) {
  const body = (
    <>
      <Icon name={p.icon} class="hud-icon" />
      <span class="hud-sv">
        <span class="hud-k">{p.k}</span>
        <span class="hud-v">{p.v}{p.sub && <span class="hud-sub">{p.sub}</span>}</span>
      </span>
    </>
  );
  const cls = `hud-cell hud-panel hud-stat hud-${p.area}${p.tone ? ' ' + p.tone : ''}`;
  return p.onClick ? (
    <button type="button" class={cls + ' hud-press'} title={p.title} aria-label={p.title} onClick={p.onClick}>{body}</button>
  ) : (
    <div class={cls} title={p.title} aria-label={p.title} role="group">{body}</div>
  );
}

function MenuGlyph() {
  return <span class="hud-burger" aria-hidden="true"><i /><i /><i /></span>;
}

export function Hud(p: HudProps) {
  const { store, kind } = p;
  const s = useStore(store);
  const now = useNow(kind === 'chat' ? 250 : 1000);
  const ref = useRef<HTMLElement>(null);
  // QA screenshots: ?mock=1&menu=1 opens the menu
  const [menu, setMenu] = useState(() => typeof location !== 'undefined' && /[?&]mock=1/.test(location.search) && /[?&]menu=1/.test(location.search));
  useEscape(() => setMenu(false));

  // measure for the world under the HUD
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => setHudHeight(el.getBoundingClientRect().height);
    report();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(report) : null;
    ro?.observe(el);
    window.addEventListener('resize', report);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [kind]);
  const firstKind = useRef(kind);
  useEffect(() => {
    if (kind !== firstKind.current) setMenu(false);
  }, [kind]);

  const cfg = s.config;
  const me = s.me;
  const round = s.round;
  const testnet = !!(cfg?.testMode || cfg?.network === 'testnet');
  const level: Level = s.chat?.level ?? s.search?.level ?? s.level;
  const room = s.rooms[level];
  const theme = s.chat?.theme ?? room?.theme ?? (round ? round.themes[level] ?? themeFor(level, round.roundId) : themeFor(level, 1));
  const accepting = round ? now < round.acceptingUntil && round.status === 'open' : false;
  const roundLeft = round ? round.endsAt - now : 0;
  const called = room?.seats.filter((x) => x.state === 'called').length ?? 0;
  const seats = room?.seats.length || 10;
  const latestReady = s.resultsReady.length ? Math.max(...s.resultsReady) : null;
  const unlocked = (L: Level) => !!cfg?.testMode || (me?.levelUnlocked ?? 1) >= L;
  const busy = !!s.search || !!s.chat;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
  const logoH = vw >= 1800 ? 50 : vw >= 700 && vh <= 520 ? 18 : 27;

  const brand = (
    <div class="hud-cell hud-brand">
      <Logo height={logoH} />
      {testnet && <span class="hud-net" title="Test network: test coins, no real value">TESTNET</span>}
    </div>
  );

  const clock = (
    <Stat
      area="clock"
      icon="clock"
      k={accepting || !round ? 'Round' : 'Next'}
      v={round ? fmtClock(roundLeft) : '–:––'}
      title={accepting || !round ? 'Round ends in' : 'Next round in'}
    />
  );
  const coinsV = me && me.balanceCoins > 0 ? fmtCoins(me.balanceCoins) : 'FREE';
  const coins = (
    <Stat
      area="coins"
      icon="coin"
      k={me && me.balanceCoins > 0 ? 'Coins' : 'Deposit'}
      v={coinsV}
      sub={me?.lockedCoins ? <><Icon name="lock" />{fmtCoins(me.lockedCoins)}</> : null}
      title={me?.lockedCoins ? `${coinsV} coins, ${fmtCoins(me.lockedCoins)} locked until the round ends` : me && me.balanceCoins > 0 ? 'Your coins' : 'Free mode: tap to deposit'}
      onClick={p.onWallet}
    />
  );
  const rating = <Stat area="rating" icon="star" k="Rating" v={me?.rating ?? '–'} title="Your rating" />;

  const menuBtn = (
    <button type="button" class="hud-cell px-btn hud-menu-btn" aria-expanded={menu} aria-haspopup="menu" title="Menu" onClick={() => setMenu(!menu)}>
      <MenuGlyph />
    </button>
  );

  let cells: ComponentChildren;
  if (kind === 'lobby') {
    cells = (
      <>
        {brand}
        <div class="hud-cell hud-panel hud-level">
          <div class="hud-tabs tabs" role="tablist" aria-label="Levels">
            {LEVELS.map((L) => (
              <button
                key={L}
                type="button"
                role="tab"
                aria-selected={L === level}
                class={'px-btn small hud-tab' + (L === level ? ' primary' : '')}
                disabled={!unlocked(L) || (busy && L !== level)}
                title={unlocked(L) ? `Level ${L}: ${THEME_NAMES[round ? round.themes[L] ?? themeFor(L, round.roundId) : themeFor(L, 1)]}` : 'Raise your rating to unlock'}
                onClick={() => L !== level && store.actions.enterRoom(L)}
              >
                {!unlocked(L) && <Icon name="lock" />}L{L}
              </button>
            ))}
          </div>
          <span class="hud-theme">{THEME_NAMES[theme]}</span>
        </div>
        {clock}
        {coins}
        {rating}
        <Stat area="called" icon="check" k="Called" v={<>{called}<span class="hud-of">/{seats}</span></>} title={`${called} of ${seats} called`} />
        <button
          type="button"
          class={'hud-cell px-btn hud-results' + (s.resultsReady.length ? ' primary' : '')}
          title="Results"
          onClick={() => (latestReady ? p.onResults?.(latestReady) : p.onRounds?.())}
        >
          <Icon name="trophy" /><span class="hud-btn-label">Results</span>
          {s.resultsReady.length > 0 && <span class="px-badge">{s.resultsReady.length}</span>}
        </button>
        {menuBtn}
      </>
    );
  } else if (kind === 'chat') {
    const chat = s.chat;
    const search = s.search;
    const chatting = chat?.phase === 'chatting' && !isCounting(chat);
    const total = (cfg?.chatSeconds ?? 120) * 1000;
    const left = chatting && chat?.endsAt ? Math.min(total, Math.max(0, chat.endsAt + (chat.clockShift ?? 0) - now)) : total;
    const paid = chat ? chat.mode === 'paid' && chat.coins > 0 : search?.mode === 'paid';
    const playing = chat ? chat.coins : search?.coins ?? 0;
    cells = (
      <>
        {brand}
        <div class="hud-cell hud-panel hud-level hud-level-static">
          <span class="hud-lv">L{level}</span>
          <span class="hud-theme">{THEME_NAMES[theme]}</span>
        </div>
        <Stat
          area="timer"
          icon="flame"
          k={chatting ? 'Chat' : search ? 'Finding' : 'Chat'}
          v={fmtClock(left)}
          tone={chatting && left < 15000 ? 'low' : ''}
          title="Time left in this chat"
        />
        <Stat area="mode" icon="coin" k={paid ? 'Playing' : 'Mode'} v={paid ? fmtCoins(playing) : 'FREE'} title={paid ? `${playing} coins on the table` : 'Free chat: score and rating only'} />
        {clock}
        {menuBtn}
      </>
    );
  } else if (kind === 'call') {
    cells = (
      <>
        {brand}
        <div class="hud-cell hud-panel hud-level hud-level-static">
          <span class="hud-lv">L{level}</span>
          <span class="hud-theme">{THEME_NAMES[theme]}</span>
        </div>
        {clock}
        {coins}
        {rating}
        {menuBtn}
      </>
    );
  } else {
    cells = (
      <>
        {brand}
        <div class="hud-cell hud-panel hud-title">{p.title}</div>
        {menuBtn}
      </>
    );
  }

  const label = me?.label ?? me?.accountId.split('.')[0] ?? s.accountId?.split('.')[0];
  const walletAccount = s.session?.accountId;
  const shortAccount = walletAccount && walletAccount.length > 22 ? `${walletAccount.slice(0, 8)}…${walletAccount.slice(-8)}` : walletAccount;
  return (
    <header ref={ref} class={'hud hud-' + kind} role="banner">
      {/* REAL's auction (mainnet): measured with the HUD, so the world lays out under it */}
      <LaunchBanner store={store} chat={kind === 'chat'} />
      <div class="hud-bar">
        {cells}
        <span class="hud-break" aria-hidden="true" />
      </div>
      {menu && (
        <>
          <div class="hud-menu-scrim" onClick={() => setMenu(false)} />
          <nav class="hud-menu px-panel sheet-enter" role="menu" aria-label="Menu">
            {kind === 'lobby' && (
              <>
                <button type="button" class="px-btn small hud-menu-item" onClick={() => { setMenu(false); p.onWallet?.(); }}>
                  <Icon name="coin" /> {me && me.balanceCoins > 0 ? 'Your coins' : 'Deposit to earn'}
                </button>
                <button type="button" class="px-btn small hud-menu-item" onClick={() => { setMenu(false); p.onRounds?.(); }}>
                  <Icon name="clock" /> Past rounds
                </button>
              </>
            )}
            {(kind === 'lobby' || kind === 'who') && (
              <a class="px-btn small hud-menu-item" href={agentsHref()} onClick={() => setMenu(false)} title="For AI builders: enter your agent, earn the Turing bonus, get the transcripts">
                <Icon name="bot" /> Run an AI? Enter it
              </a>
            )}
            <button type="button" class="px-btn small hud-menu-item" onClick={() => { setMenu(false); p.onTerms?.(); }}>
              <Icon name="shield" /> Terms
            </button>
            {kind === 'lobby' && walletAccount && (
              <button type="button" class="px-btn small hud-menu-item" title={walletAccount} onClick={() => { setMenu(false); p.onSignOut?.(); }}>
                <Icon name="user" /> Sign out ({shortAccount})
              </button>
            )}
            {kind === 'lobby' && !walletAccount && label && (
              <button type="button" class="px-btn small hud-menu-item" onClick={() => { setMenu(false); p.onSwitchUser?.(); }}>
                <Icon name="user" /> Switch player ({label})
              </button>
            )}
            {kind !== 'who' && <DevMenu store={store} onDone={() => setMenu(false)} />}
          </nav>
        </>
      )}
    </header>
  );
}
