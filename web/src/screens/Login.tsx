// "Before you play": the one way in. A guest watching the room who taps a character (or "Sign in") gets it: first
// the short terms with one checkbox, "I'm 18 or older, I play at my own risk and I accept the terms", and Continue,
// compulsory (no close, no click outside, Esc does nothing); then the sign-in: a NEAR wallet (NEAR Connect), and on
// testnet the six test players too. Once signed in the prompt goes and the tapped character's seat opens (app.tsx).
// A signed-in player whose accepted terms are older than the current version (state/consent.ts) gets the first step
// alone. Accepting is remembered in this browser until the terms version changes.

import { useEffect, useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { acceptTerms, termsAccepted } from '../state/consent.ts';
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
}) {
  const s = useStore(p.store);
  const cfg = s.config;
  const [step, setStep] = useState<'consent' | 'signin'>(() => (termsAccepted() && !p.consentOnly ? 'signin' : 'consent'));
  const [ticked, setTicked] = useState(!!p.ticked);
  const busy = s.signIn.phase === 'preparing' || s.signIn.phase === 'wallet' || s.signIn.phase === 'checking' || s.status === 'connecting';
  const testMode = !!cfg?.testMode;
  const walletOn = !!cfg?.wallet && !!p.store.wallet && !!p.store.client.authChallenge;
  const close = () => {
    if (step === 'signin' && !busy) p.onClose();
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
              <Button kind="primary" disabled={!ticked} onClick={accept}>Continue</Button>
            </div>
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
          <h2 id="login-title" class="px-title">Sign in to play</h2>
          <Button small kind="ghost" disabled={busy} onClick={close}>Back</Button>
        </div>
        {walletOn && <WalletSignInPanel store={p.store} tight />}
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
