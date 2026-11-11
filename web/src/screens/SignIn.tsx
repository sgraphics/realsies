// Wallet sign-in (protocol v1.3): one wallet approval signs a message (NEP-413), no transaction, no gas. The panel
// sits in the sign-in step of "Before you play" (Login.tsx), which a guest reaches by tapping a character or
// "Sign in"; on testnet the six test players are offered next to it.

import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';

/**
 * The sign-in panel: one button, then "waiting for your wallet", "checking", or what went wrong and "Try again".
 * `secondary`: next to the free practice chat (protocol v1.14), which is the green choice, so its button is the plain one.
 */
export function WalletSignInPanel(p: { store: Store; tight?: boolean; secondary?: boolean }) {
  const s = useStore(p.store);
  const f = s.signIn;
  const kind = p.secondary ? 'default' : 'primary';
  const busy = f.phase === 'preparing' || f.phase === 'wallet' || f.phase === 'checking';
  // straight from the tap: with the challenge fetched ahead (the prompt's prepareSignIn) the wallet opens in this turn
  const signIn = () => void p.store.actions.walletSignIn();
  return (
    <div class={'px-panel signin-panel sheet-enter' + (p.tight ? ' tight' : '')} role="group" aria-label="Sign in">
      {f.phase === 'wallet' ? (
        <div class="flow-line" role="status">
          <span class="flow-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>Waiting for your wallet. Approve the sign-in there.</span>
        </div>
      ) : f.phase === 'checking' ? (
        <div class="flow-line" role="status">
          <span class="flow-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>Checking your signature on NEAR…</span>
        </div>
      ) : f.phase === 'error' ? (
        <>
          <p class="px-sub px-bad flow-error" role="alert"><Icon name="cross" /> {f.error}</p>
          <Button kind={kind} class="signin-btn" onClick={signIn}>
            <Icon name="shield" /> Try again
          </Button>
          {/* some wallets fail to sign a message (seen with OKX Wallet on 2026-11-11): name a way out */}
          <p class="px-sub px-dim">If it keeps failing, try another wallet, for example Meteor or Intear.</p>
        </>
      ) : f.phase === 'preparing' ? (
        <Button kind={kind} class="signin-btn" disabled>
          <Icon name="clock" /> Preparing…
        </Button>
      ) : (
        <Button kind={kind} class="signin-btn" onClick={signIn}>
          <Icon name="shield" /> Sign in with a NEAR wallet
        </Button>
      )}
      <ul class="signin-points">
        <li><Icon name="check" /><span>Free to play. Signing in is a signature: no transaction, no gas.</span></li>
        <li><Icon name="coin" /><span>Coins later, with one wallet approval.</span></li>
      </ul>
      <div class="px-row between signin-foot">
        {/* the list's Meteor and Intear are web wallets: a newcomer needs no extension and no app (2026-11-11: visitors with
            an exchange's wallet got stuck, and "Get a wallet" sent them to a directory) */}
        <span class="px-dim">No NEAR wallet yet? Pick Meteor or Intear in the list: they open in your browser, nothing to install.</span>
        {busy && <Button small kind="ghost" onClick={() => p.store.actions.resetFlow('signIn')}>Cancel</Button>}
      </div>
    </div>
  );
}
