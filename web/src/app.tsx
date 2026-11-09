// App root: picks the screen from store state (the room as a guest -> the room as a player -> searching/chat ->
// call -> locked) and layers the dialogs (sign-in, seat, deposit, results, verify, past rounds) on top. A guest
// watches the room without a session; tapping a character (or "Sign in") opens "Before you play" (Login.tsx): the
// terms with one checkbox, then the sign-in; once signed in, the tapped character's seat opens.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Level, Seat, ThemeId } from '../../shared/protocol.ts';
import { themeFor } from '../../shared/protocol.ts';
import type { Store } from './state/store.ts';
import { useStore } from './state/hooks.ts';
import { LobbyScreen } from './screens/Lobby.tsx';
import { LoginModal } from './screens/Login.tsx';
import { AuctionDepositDialog } from './launch/AuctionDeposit.tsx';
import { auctionDepositOn } from './launch/auction.ts';
import { SeatDialog } from './screens/SeatDialog.tsx';
import { DepositDialog } from './screens/Deposit.tsx';
import { ChatScreen } from './screens/Chat.tsx';
import { CallScreen } from './screens/Call.tsx';
import { ResultsScreen } from './screens/Results.tsx';
import { VerifyDrawer } from './screens/Verify.tsx';
import { PastRounds } from './screens/PastRounds.tsx';
import { TermsScreen } from './screens/Terms.tsx';
import { KeySetupDialog } from './screens/KeySetup.tsx';
import { Button, Icon, type IconName } from './ui/kit.tsx';
import { applyTheme } from './ui/theme.ts';
import { qaAmount, qaConsent, qaTicked, runQa } from './qa.ts';
import { airdropOn, holdsAny, panelMode } from './state/airdrop.ts';
import { termsAccepted } from './state/consent.ts';
import type { PendingSeat } from './state/guest.ts';
import { BETA_OVER, BETA_OVER_LANDING, BETA_REDIRECT_MS, betaEndOf, betaOverUrl, chatRunning, consumeBetaOver } from './state/beta.ts';

type Overlay =
  | { kind: 'seat'; level: Level; seat: Seat }
  | { kind: 'deposit'; gate: boolean; then?: Overlay | null; prefill?: string }
  | { kind: 'results'; roundId: number }
  | { kind: 'rounds' }
  // the one approval for the browser's play key, opened by a paid pick without one; `pick` goes on once it is on
  // chain, Cancel goes `back`
  | { kind: 'key'; pick?: { level: Level; seatIndex: number; coins: number }; why?: string; back?: Overlay | null }
  | null;

export function App({ store }: { store: Store }) {
  const s = useStore(store);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [verify, setVerify] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: 'error' | 'info'; at: number; icon?: IconName; results?: boolean; ms?: number } | null>(null);
  const gated = useRef(new Set<string>());
  const lastReady = useRef(0);
  // the terms of this version accepted in this browser (QA screenshots past this step accept them first)
  const [consented, setConsented] = useState(() => {
    qaConsent(location.search);
    return termsAccepted();
  });
  // "Before you play" for a guest, with the seat that was tapped (or none: the HUD's Sign in)
  const [login, setLogin] = useState<{ seat?: PendingSeat } | null>(null);
  // the tapped seat, waiting for the player's own room after sign-in
  const pending = useRef<PendingSeat | null>(null);
  // the REAL auction's deposit dialog (Get $REAL on the banner); a guest signs in first, then it opens
  const [auction, setAuction] = useState(false);
  const pendingAuction = useRef(false);

  // the testnet beta is over (config.betaClosed, or a beta_closed error): one calm note across the top, then, 5 s on
  // and once the player's running chat (and its call) is done, the relay's redirect with ?beta=over
  const betaEnd = betaEndOf(s);
  const running = chatRunning(s);
  useEffect(() => {
    if (!betaEnd || running) return;
    const t = setTimeout(() => location.assign(betaOverUrl(betaEnd.redirect, location.href)), BETA_REDIRECT_MS);
    return () => clearTimeout(t);
  }, [!!betaEnd, betaEnd?.redirect, running]);
  // arrived from a closed beta (?beta=over): one thank-you line; the parameter leaves the address
  useEffect(() => {
    if (consumeBetaOver()) setToast({ text: BETA_OVER_LANDING, kind: 'info', at: Date.now(), icon: 'chat', ms: 7000 });
  }, []);

  useEffect(() => {
    // a wallet session stored in this browser signs straight back in (QA runs drive their own)
    const qa = /[?&](qa|as)=/.test(location.search);
    store.actions.loadConfig().then(() => (qa ? undefined : store.actions.resumeSession())).catch(() => {});
    // mock-mode screenshot hooks (?mock=1&as=ana&qa=chat ...)
    runQa(store, location.search, (what, arg) => {
      if (what === 'seat') setOverlay({ kind: 'seat', ...(arg as { level: Level; seat: Seat }) });
      if (what === 'deposit') setOverlay({ kind: 'deposit', gate: false, prefill: (arg as { prefill?: string } | undefined)?.prefill });
      if (what === 'key') setOverlay({ kind: 'key' });
      if (what === 'rounds') setOverlay({ kind: 'rounds' });
      if (what === 'results') setOverlay({ kind: 'results', roundId: arg as number });
      if (what === 'verify') setVerify(arg as string);
      if (what === 'terms') setTerms(true);
      if (what === 'login') setLogin({ seat: arg as PendingSeat | undefined });
      if (what === 'auction') setAuction(true);
    }).catch((e) => console.warn(e));
  }, [store]);

  // mainnet: NEAR Connect loads once the room is on screen and the browser is idle, so the first tap finds it ready
  // (a phone opens a wallet only from the tap itself, with nothing loading in between)
  const mainnet = s.config?.network === 'mainnet' && !!s.config.wallet;
  useEffect(() => {
    if (!mainnet || !store.wallet?.warm) return;
    const warm = () => store.wallet?.warm?.();
    const w = window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(warm, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(h);
    }
    const t = setTimeout(warm, 1500); // Safari: no idle callback
    return () => clearTimeout(t);
  }, [mainnet]);

  // a guest watches the room: the current round, public, no session; again every 30 s
  const configured = !!s.config;
  useEffect(() => {
    if (s.accountId || !configured) return;
    void store.actions.loadGuest();
    const t = setInterval(() => void store.actions.loadGuest(), 30_000);
    return () => clearInterval(t);
  }, [s.accountId, configured]);
  // and the next round as soon as this one ends
  useEffect(() => {
    if (s.accountId || !s.round) return;
    const t = setTimeout(() => void store.actions.loadGuest(), Math.max(1000, s.round.endsAt - Date.now() + 3000));
    return () => clearTimeout(t);
  }, [s.accountId, s.round?.endsAt]);

  // signed in (a wallet, or a test player): the prompt goes; the tapped seat waits for the player's own room
  useEffect(() => {
    if (!s.accountId) return;
    setConsented(termsAccepted());
    if (pendingAuction.current) {
      pendingAuction.current = false;
      setAuction(true);
    }
    if (!login) return;
    if (login.seat) pending.current = login.seat;
    setLogin(null);
  }, [s.accountId]);
  useEffect(() => {
    const want = pending.current;
    if (!want || !s.accountId || !s.welcomed || s.chat || s.search) return;
    const room = s.rooms[want.level];
    if (!room) {
      if (s.level !== want.level) store.actions.enterRoom(want.level);
      return;
    }
    pending.current = null;
    const seat = room.seats[want.index];
    if (seat && seat.state === 'open') setOverlay({ kind: 'seat', level: want.level, seat });
  }, [s.accountId, s.welcomed, s.rooms, s.level]);

  // theme of what is on screen drives the CSS kit (panels, buttons, bubbles)
  const round = s.round;
  const level = s.chat?.level ?? s.search?.level ?? s.level;
  const theme: ThemeId = s.chat?.theme ?? s.rooms[level]?.theme ?? (round ? round.themes[level] ?? themeFor(level, round.roundId) : 'castle');
  useEffect(() => applyTheme(theme), [theme]);

  // the relay refused a paid pick for want of a usable play key: the one approval, then the same pick
  useEffect(() => {
    if (!s.keyNeeded) return;
    const why = s.keyNeeded.code === 'play_key_exhausted' ? 'This browser used up its approval.' : undefined;
    setOverlay({ kind: 'key', why, pick: s.keyNeeded.pick });
    store.actions.clearKeyNeeded();
  }, [s.keyNeeded?.at]);

  // "Deposit to earn" before entering a room while the balance is zero (once per level and round). On the testnet
  // demo the TESTNET panel is the first step: while it shows (the player holds nothing at all) nothing covers it.
  const dropKnown = s.airdrop.status !== undefined;
  useEffect(() => {
    if (!s.welcomed || !s.me || !round || s.chat || s.search) return;
    if (s.me.balanceCoins > 0) return;
    if (s.config?.coinsOpen === false) return; // nothing to deposit yet: free play only
    const key = `${s.accountId}:${round.roundId}:${s.level}`;
    if (gated.current.has(key)) return;
    if (pending.current) {
      gated.current.add(key); // the tapped character's seat comes first
      return;
    }
    if (airdropOn(s.config) && !dropKnown && !holdsAny(s)) return; // the relay's view of the airdrop first
    gated.current.add(key);
    if (panelMode(s, 'lobby') !== 'none') return;
    setOverlay((o) => o ?? { kind: 'deposit', gate: true });
  }, [s.welcomed, s.level, round?.roundId, s.me?.balanceCoins, s.accountId, dropKnown]);

  // errors and results as toasts
  useEffect(() => {
    if (s.lastError) {
      setToast({ text: s.lastError.message || s.lastError.code, kind: 'error', at: Date.now() });
      const t = setTimeout(() => store.actions.clearError(), 4500);
      return () => clearTimeout(t);
    }
  }, [s.lastError?.at]);
  useEffect(() => {
    const newest = s.resultsReady.length ? Math.max(...s.resultsReady) : 0;
    if (newest > lastReady.current) {
      if (lastReady.current) setToast({ text: `Round ${newest} results are in!`, kind: 'info', at: Date.now(), results: true });
      lastReady.current = newest;
    }
  }, [s.resultsReady.join()]);
  // friendly notes (the bots are napping) as calm toasts, never red
  useEffect(() => {
    if (!s.notice) return;
    // two sentences: a little longer on screen than an error
    setToast({ text: s.notice.message, kind: 'info', at: Date.now(), icon: s.notice.code === 'bots_unavailable' ? 'bot' : s.notice.code === 'airdrop' ? 'coin' : 'chat', ms: 7000 });
    const t = setTimeout(() => store.actions.clearNotice(), 7000);
    return () => clearTimeout(t);
  }, [s.notice?.at]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.ms ?? 4500);
    return () => clearTimeout(t);
  }, [toast?.at]);

  const testnet = !!(s.config?.testMode || s.config?.network === 'testnet');
  const openTerms = () => setTerms(true);
  const openLogin = (seat?: PendingSeat) => setLogin({ seat });
  // Get $REAL: the deposit dialog for a wallet player; a guest signs in first (mainnet, while the auction runs)
  const openAuction = auctionDepositOn(s.config, Date.now())
    ? () => {
        if (s.session) setAuction(true);
        else {
          pendingAuction.current = true;
          openLogin();
        }
      }
    : undefined;
  // a signed-in player whose accepted terms are older than the current version: the terms again, first
  const reconsent = !!s.accountId && !consented;
  let screen;
  if (!s.accountId)
    screen = (
      <LobbyScreen
        store={store}
        guest
        selectedSeat={login?.seat?.level === s.level ? login.seat.index : null}
        onSeat={(lv, seat) => openLogin({ level: lv, index: seat.index })}
        onSignIn={() => openLogin()}
        onAuctionDeposit={openAuction}
        onResults={() => openLogin()}
        onRounds={() => openLogin()}
        onWallet={() => openLogin()}
        onSwitchUser={() => openLogin()}
        onTerms={openTerms}
      />
    );
  else if (s.search && !s.chat) screen = <ChatScreen store={store} onTerms={openTerms} />;
  else if (s.chat && (s.chat.phase === 'searching' || s.chat.phase === 'placing' || s.chat.phase === 'chatting')) screen = <ChatScreen store={store} onTerms={openTerms} />;
  else if (s.chat) screen = <CallScreen store={store} onBack={() => store.actions.clearChat()} onTerms={openTerms} />;
  else
    screen = (
      <LobbyScreen
        store={store}
        selectedSeat={overlay?.kind === 'seat' ? overlay.seat.index : null}
        onSeat={(lv, seat) => {
          if (seat.state !== 'open') return;
          setOverlay({ kind: 'seat', level: lv, seat });
        }}
        onResults={(roundId) => {
          setOverlay({ kind: 'results', roundId });
          store.actions.markResultsSeen(roundId);
        }}
        onRounds={() => setOverlay({ kind: 'rounds' })}
        onWallet={() => setOverlay({ kind: 'deposit', gate: false })}
        onSwitchUser={() => {
          setOverlay(null);
          store.actions.logout();
        }}
        onSignOut={() => {
          setOverlay(null);
          void store.actions.signOut();
        }}
        onAuctionDeposit={openAuction}
        onTerms={openTerms}
      />
    );

  const modal = (!!login && !s.accountId) || reconsent;
  return (
    <>
      {/* behind "Before you play" nothing takes a tap or a key */}
      <div class="app-screen" inert={modal}>{screen}</div>
      {modal && (
        <LoginModal
          store={store}
          consentOnly={reconsent}
          ticked={qaTicked(location.search)}
          onConsent={() => setConsented(true)}
          onClose={() => {
            pendingAuction.current = false;
            setLogin(null);
          }}
        />
      )}
      {auction && s.session && !modal && <AuctionDepositDialog store={store} onClose={() => setAuction(false)} amount={qaAmount(location.search)} />}
      {overlay?.kind === 'seat' && (
        <SeatDialog
          store={store}
          level={overlay.level}
          seat={overlay.seat}
          theme={s.rooms[overlay.level]?.theme ?? theme}
          onClose={() => setOverlay(null)}
          onDeposit={() => setOverlay({ kind: 'deposit', gate: false, then: overlay })}
          onNeedKey={(coins) => setOverlay({ kind: 'key', pick: { level: overlay.level, seatIndex: overlay.seat.index, coins }, back: overlay })}
        />
      )}
      {overlay?.kind === 'deposit' && (
        <DepositDialog
          store={store}
          gate={overlay.gate}
          prefill={overlay.prefill}
          onDone={() => setOverlay(overlay.then ?? null)}
        />
      )}
      {overlay?.kind === 'key' && (
        <KeySetupDialog
          store={store}
          why={overlay.why}
          onDone={(enabled) => {
            const o = overlay;
            if (enabled && o.pick) {
              setOverlay(null);
              store.actions.pickSeat(o.pick.level, o.pick.seatIndex, 'paid', o.pick.coins);
            } else setOverlay(enabled ? null : o.back ?? null);
          }}
        />
      )}
      {overlay?.kind === 'results' && (
        <ResultsScreen
          store={store}
          roundId={overlay.roundId}
          onVerify={(chatId) => setVerify(chatId)}
          onClose={() => setOverlay(null)}
          onDeposit={() => setOverlay({ kind: 'deposit', gate: false })}
        />
      )}
      {overlay?.kind === 'rounds' && (
        <PastRounds
          store={store}
          onOpenResults={(roundId) => {
            setOverlay({ kind: 'results', roundId });
            store.actions.markResultsSeen(roundId);
          }}
          onClose={() => setOverlay(null)}
        />
      )}
      {verify && <VerifyDrawer store={store} chatId={verify} onClose={() => setVerify(null)} />}
      {terms && <TermsScreen testnet={testnet} onClose={() => setTerms(false)} />}
      {s.accountId && s.status !== 'open' && s.welcomed && (
        <div class="toast-stack"><div class="px-panel tight toast">Reconnecting…</div></div>
      )}
      {betaEnd && (
        <div class="beta-over" role="status" aria-live="polite">
          <Icon name="chat" /> <span class="px-body">{BETA_OVER}</span>
        </div>
      )}
      {toast && (
        <div class="toast-stack" role="status">
          <div class={'px-panel tight toast sheet-enter ' + toast.kind}>
            <span class="px-row nowrap">
              <Icon name={toast.icon ?? (toast.kind === 'error' ? 'cross' : 'trophy')} /> <span class="px-body" style={{ fontSize: '15px' }}>{toast.text}</span>
              {toast.results && s.resultsReady.length > 0 && (
                <Button small kind="primary" onClick={() => { const r = Math.max(...s.resultsReady); setOverlay({ kind: 'results', roundId: r }); store.actions.markResultsSeen(r); setToast(null); }}>Open</Button>
              )}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
