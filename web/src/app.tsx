// App root: picks the screen from store state (who are you -> lobby -> searching/chat -> call ->
// locked) and layers the dialogs (seat, deposit, results, verify, past rounds) on top.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Level, Seat, ThemeId } from '../../shared/protocol.ts';
import { themeFor } from '../../shared/protocol.ts';
import type { Store } from './state/store.ts';
import { useStore } from './state/hooks.ts';
import { WhoScreen } from './screens/Who.tsx';
import { LobbyScreen } from './screens/Lobby.tsx';
import { SeatDialog } from './screens/SeatDialog.tsx';
import { DepositDialog } from './screens/Deposit.tsx';
import { ChatScreen } from './screens/Chat.tsx';
import { CallScreen } from './screens/Call.tsx';
import { ResultsScreen } from './screens/Results.tsx';
import { VerifyDrawer } from './screens/Verify.tsx';
import { PastRounds } from './screens/PastRounds.tsx';
import { TermsScreen } from './screens/Terms.tsx';
import { Button, Icon, type IconName } from './ui/kit.tsx';
import { applyTheme } from './ui/theme.ts';
import { runQa } from './qa.ts';

type Overlay =
  | { kind: 'seat'; level: Level; seat: Seat }
  | { kind: 'deposit'; gate: boolean; then?: Overlay | null }
  | { kind: 'results'; roundId: number }
  | { kind: 'rounds' }
  | null;

export function App({ store }: { store: Store }) {
  const s = useStore(store);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [verify, setVerify] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: 'error' | 'info'; at: number; icon?: IconName; results?: boolean; ms?: number } | null>(null);
  const gated = useRef(new Set<string>());
  const lastReady = useRef(0);

  useEffect(() => {
    store.actions.loadConfig().catch(() => {});
    // mock-mode screenshot hooks (?mock=1&as=ana&qa=chat ...)
    runQa(store, location.search, (what, arg) => {
      if (what === 'seat') setOverlay({ kind: 'seat', ...(arg as { level: Level; seat: Seat }) });
      if (what === 'deposit') setOverlay({ kind: 'deposit', gate: false });
      if (what === 'rounds') setOverlay({ kind: 'rounds' });
      if (what === 'results') setOverlay({ kind: 'results', roundId: arg as number });
      if (what === 'verify') setVerify(arg as string);
      if (what === 'terms') setTerms(true);
    }).catch((e) => console.warn(e));
  }, [store]);

  // theme of what is on screen drives the CSS kit (panels, buttons, bubbles)
  const round = s.round;
  const level = s.chat?.level ?? s.search?.level ?? s.level;
  const theme: ThemeId = s.chat?.theme ?? s.rooms[level]?.theme ?? (round ? round.themes[level] ?? themeFor(level, round.roundId) : 'castle');
  useEffect(() => applyTheme(theme), [theme]);

  // "Deposit to earn" before entering a room while the balance is zero (once per level and round)
  useEffect(() => {
    if (!s.welcomed || !s.me || !round || s.chat || s.search) return;
    if (s.me.balanceCoins > 0) return;
    const key = `${s.accountId}:${round.roundId}:${s.level}`;
    if (gated.current.has(key)) return;
    gated.current.add(key);
    setOverlay((o) => o ?? { kind: 'deposit', gate: true });
  }, [s.welcomed, s.level, round?.roundId, s.me?.balanceCoins, s.accountId]);

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
    setToast({ text: s.notice.message, kind: 'info', at: Date.now(), icon: s.notice.code === 'bots_unavailable' ? 'bot' : 'chat', ms: 7000 });
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
  let screen;
  if (!s.accountId) screen = <WhoScreen store={store} onTerms={openTerms} />;
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
        onTerms={openTerms}
      />
    );

  return (
    <>
      {screen}
      {overlay?.kind === 'seat' && (
        <SeatDialog
          store={store}
          level={overlay.level}
          seat={overlay.seat}
          theme={s.rooms[overlay.level]?.theme ?? theme}
          onClose={() => setOverlay(null)}
          onDeposit={() => setOverlay({ kind: 'deposit', gate: false, then: overlay })}
        />
      )}
      {overlay?.kind === 'deposit' && (
        <DepositDialog
          store={store}
          gate={overlay.gate}
          onDone={() => setOverlay(overlay.then ?? null)}
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
