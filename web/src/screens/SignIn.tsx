// Wallet sign-in (protocol v1.3): one wallet approval signs a message (NEP-413), no transaction, no gas. The panel
// sits in the sign-in step of "Before you play" (Login.tsx), which a guest reaches by tapping a character or
// "Sign in"; on testnet the six test players are offered next to it.

import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';

export const GET_A_WALLET_URL = 'https://wallet.near.org';

/** The sign-in panel: one button, then "waiting for your wallet", "checking", or what went wrong. */
export function WalletSignInPanel(p: { store: Store; tight?: boolean }) {
  const s = useStore(p.store);
  const f = s.signIn;
  const busy = f.phase === 'wallet' || f.phase === 'checking';
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
      ) : (
        <Button kind="primary" class="signin-btn" onClick={() => void p.store.actions.walletSignIn()}>
          <Icon name="shield" /> Sign in with a NEAR wallet
        </Button>
      )}
      {f.phase === 'error' && <p class="px-sub px-bad flow-error"><Icon name="cross" /> {f.error}</p>}
      <ul class="signin-points">
        <li><Icon name="check" /><span>Free to play. Signing in is a signature: no transaction, no gas.</span></li>
        <li><Icon name="coin" /><span>Coins later, with one wallet approval.</span></li>
      </ul>
      <div class="px-row between signin-foot">
        <span class="px-dim">New to NEAR? <a class="px-link" href={GET_A_WALLET_URL} target="_blank" rel="noreferrer">Get a wallet <Icon name="link" /></a></span>
        {busy && <Button small kind="ghost" onClick={() => p.store.actions.resetFlow('signIn')}>Cancel</Button>}
      </div>
    </div>
  );
}
