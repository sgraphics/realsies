// "Before you play": the one way in. A guest watching the room who taps a character (or "Sign in") gets it: first
// the short terms with one checkbox, "I'm 18 or older, I play at my own risk and I accept the terms", and Continue,
// compulsory (no close, no click outside, Esc does nothing); then the sign-in: a NEAR wallet (NEAR Connect), and on
// testnet the six test players too. Once signed in the prompt goes and the tapped character's seat opens (app.tsx).
// Where the relay offers the practice chat (protocol v1.14) and this browser has a free try left today, the terms'
// button is "Start free chat": it accepts the terms and starts the chat with the tapped character at once (a chat with
// a house bot, the reveal right after the call); a small link under it, "I have a NEAR wallet: sign in", goes to the
// sign-in instead. (A guest who accepted the terms before gets no prompt at all on a tap: app.tsx starts the chat.)
// The sign-in step offers the same two choices, "Start free chat" and the wallet, unless it was opened to sign in
// (`wallet`: the menu's Sign in, the reveal's, Get $REAL). When this browser or its network had its tries today, or
// every free chat of the day is gone, the try gives way to one plain line saying why, and the terms say Continue.
// A signed-in player whose accepted terms are older than the current version (state/consent.ts) gets the first step
// alone. Accepting is remembered in this browser until the terms version changes.

import { useEffect, useState } from 'preact/hooks';
import type { PracticeAnswer, Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { acceptTerms, termsAccepted } from '../state/consent.ts';
import { TRY_FREE, WALLET_LINK, practiceOn, refusalLine, tryLeft } from '../state/practice.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { useEscape } from '../ui/hooks.ts';
import { TermsList } from './Terms.tsx';
import { WalletSignInPanel } from './SignIn.tsx';

export const CONSENT_LINE = "I'm 18 or older, I play at my own risk and I accept the terms";

export function LoginModal(p: {
  store: Store;
  /** a signed-in player whose accepted terms are older than the current version: the first step alone */
  consentOnly?: boolean;
  /** QA: the box already ticked */
  ticked?: boolean;
  /** the terms were accepted (Continue) */
  onConsent(): void;
  /** the guest closed the sign-in step: back to watching */
  onClose(): void;
  /** v1.14: "Start free chat" (a guest, where the relay offers it); the app closes the prompt once it starts */
  onPractice?(): Promise<PracticeAnswer>;
  /** opened from the reveal of a practice chat: the guest knows the try is used, so no line says it */
  afterPractice?: boolean;
  /** opened to sign in (the menu's "Sign in to play", the reveal's Sign in, Get $REAL): the wallet, no free chat offered */
  wallet?: boolean;
}) {
  const s = useStore(p.store);
  const cfg = s.config;
  const [step, setStep] = useState<'consent' | 'signin'>(() => (termsAccepted() && !p.consentOnly ? 'signin' : 'consent'));
  const [ticked, setTicked] = useState(!!p.ticked);
  const busy = s.signIn.phase === 'preparing' || s.signIn.phase === 'wallet' || s.signIn.phase === 'checking' || s.status === 'connecting';
  const testMode = !!cfg?.testMode;
  const walletOn = !!cfg?.wallet && !!p.store.wallet && !!p.store.client.authChallenge;
  // the free try: asked as the prompt opens, so the answer is in by the time the terms are read (null: asking)
  const tryOn = !p.consentOnly && !!p.onPractice && practiceOn(cfg);
  const [offer, setOffer] = useState<PracticeAnswer | null>(null);
  const [starting, setStarting] = useState(false);
  // a tap that could not start it for another reason (the relay unreachable): said in its own words
  const [tapError, setTapError] = useState<string | null>(null);
  useEffect(() => {
    if (!tryOn) return;
    let live = true;
    void p.store.actions.practiceStatus().then((a) => live && setOffer(a));
    return () => {
      live = false;
    };
  }, [tryOn]);
  // the wallet's way chosen (opened to sign in, or the terms' link): the sign-in alone
  const [wallet, setWallet] = useState(!!p.wallet);
  const offerTry = tryOn && !wallet && tryLeft(cfg) && (offer === null || offer.ok);
  // (a status that could not be read just leaves the try out: the sign-in is still there)
  const why = tryOn && !p.afterPractice && offer && !offer.ok ? refusalLine(offer.reason) ?? tapError : null;
  const tryIt = async (): Promise<PracticeAnswer | null> => {
    if (!p.onPractice || starting) return null;
    setStarting(true);
    const a = await p.onPractice();
    // started: the app has closed the prompt; refused: the plain line in place of the try
    if (!a.ok) {
      setTapError(a.error ?? null);
      setOffer(a);
      setStarting(false);
    }
    return a;
  };
  const close = () => {
    if (step === 'signin' && !busy && !starting) p.onClose();
  };
  // Esc and a click outside close the sign-in step only; the terms step is not optional
  useEscape(close);
  useEffect(() => {
    if (step === 'signin' && testMode) void p.store.actions.loadTestUsers().catch(() => {});
  }, [step, testMode]);
  // the wallet's sign-in ready before the tap, from the moment the prompt opens: NEAR Connect loaded and the challenge
  // fetched (again once it is 5 minutes old), so the tap opens the wallet at once; a phone allows nothing later
  useEffect(() => {
    if (!walletOn || p.consentOnly) return;
    p.store.wallet?.warm?.();
    void p.store.actions.prepareSignIn();
    const t = setInterval(() => void p.store.actions.prepareSignIn(), 30_000);
    return () => clearInterval(t);
  }, [walletOn, p.consentOnly]);

  if (step === 'consent') {
    const accept = () => {
      if (!ticked) return;
      acceptTerms();
      p.onConsent();
      if (!p.consentOnly) setStep('signin');
    };
    // a free try left: the terms' button starts it at once (refused: the sign-in step, with the line why)
    const startFree = async () => {
      if (!ticked || starting) return;
      acceptTerms();
      p.onConsent();
      const a = await tryIt();
      if (a && !a.ok) setStep('signin');
    };
    const toWallet = () => {
      if (!ticked || starting) return;
      acceptTerms();
      p.onConsent();
      setWallet(true);
      setStep('signin');
    };
    return (
      <div class="scrim login-scrim">
        <div class="modal narrow px-panel sheet-enter px-terms login-modal login-consent" role="dialog" aria-modal="true" aria-labelledby="login-title">
          {/* the terms scroll; the box and Continue stay in view */}
          <div class="login-scroll">
            <h2 id="login-title" class="px-title">Before you play</h2>
            <TermsList testnet={testMode || cfg?.network === 'testnet'} />
            <p class="px-dim login-full">
              <a class="px-link" href="/terms.html" target="_blank" rel="noopener">Full terms <Icon name="link" /></a>
            </p>
          </div>
          <div class="login-accept">
            <label class={'who-consent login-check' + (ticked ? ' on' : '')}>
              <input type="checkbox" checked={ticked} onChange={(e) => setTicked((e.target as HTMLInputElement).checked)} />
              <span class="who-check" aria-hidden="true"><Icon name="check" /></span>
              <span>{CONSENT_LINE}</span>
            </label>
            <div class="px-row center">
              {offerTry ? (
                <Button kind="primary" class="login-start" disabled={!ticked || starting} onClick={() => void startFree()}>
                  <Icon name="chat" /> {starting ? 'Starting…' : TRY_FREE}
                </Button>
              ) : (
                <Button kind="primary" disabled={!ticked} onClick={accept}>Continue</Button>
              )}
            </div>
            {offerTry && (walletOn || testMode) && (
              <p class="login-wallet">
                <button type="button" class="px-link" disabled={!ticked || starting} onClick={toWallet}>
                  {walletOn ? WALLET_LINK : 'Play as a test player'}
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const users = s.testUsers ?? [];
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="modal narrow px-panel sheet-enter login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <div class="px-row px-head">
          <h2 id="login-title" class="px-title">{offerTry ? 'Ready to play?' : 'Sign in to play'}</h2>
          <Button small kind="ghost" disabled={busy || starting} onClick={close}>Back</Button>
        </div>
        {why && <p class="px-sub login-why" role="status">{why}</p>}
        {offerTry && (
          <Button kind="primary" class="login-try" disabled={offer === null || starting || busy} onClick={() => void tryIt()}>
            <Icon name="chat" /> {starting ? 'Starting…' : TRY_FREE}
          </Button>
        )}
        {walletOn && <WalletSignInPanel store={p.store} tight secondary={offerTry} />}
        {testMode && (
          <div class="login-players-box">
            <p class="px-sub">{walletOn ? 'Or play as a test player:' : 'Play as a test player:'}</p>
            <div class="login-players" role="group" aria-label="Test players">
              {users.map((u) => (
                <button
                  key={u.accountId}
                  type="button"
                  class="px-btn login-player"
                  disabled={busy}
                  onClick={() => void p.store.actions.selectUser(u.accountId).catch(() => {})}
                >
                  <span class="login-name">{u.label}</span>
                  <span class="login-meta"><Icon name="coin" />{u.balanceCoins} <Icon name="star" />{u.rating}</span>
                </button>
              ))}
              {!users.length && <p class="px-dim">Loading players…</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
