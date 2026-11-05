// Wallet sign-in (protocol v1.3). Without test mode (mainnet) it replaces the test-user picker: two
// characters on pedestals, "Human?" and "Bot?", over the sign-in panel. The panel is also offered on the
// test-user screen in test mode. One wallet approval signs a message (NEP-413): no transaction, no gas.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { World } from '../world/World.tsx';
import { useRigs } from '../ui/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { Hud } from '../ui/Hud.tsx';
import { NameTag } from '../ui/NameTag.tsx';
import type { SceneSeat } from '../../../art/src/scene/types.ts';
import { themeFor } from '../../../shared/protocol.ts';
import { acceptTerms, termsAccepted } from '../state/consent.ts';
import { agentsHref } from '../agents/route.ts';
import { sha256Hex } from '../verify/crypto.ts';

export const GET_A_WALLET_URL = 'https://wallet.near.org';

/** The 18+ line, as on the test-user screen; `nudge` replays its shake when someone skips it. */
export function ConsentLine(p: { nudge: number; box: { current: HTMLInputElement | null }; onAccept(): void; onTerms(): void }) {
  return (
    <label key={p.nudge} class={'who-consent' + (p.nudge ? ' nudge' : '')}>
      <input
        ref={p.box}
        type="checkbox"
        onChange={(e) => {
          if ((e.target as HTMLInputElement).checked) {
            acceptTerms();
            p.onAccept();
          }
        }}
      />
      <span class="who-check" aria-hidden="true"><Icon name="check" /></span>
      <span>I'm 18 or older and accept the <button type="button" class="px-link" onClick={(e) => { e.preventDefault(); p.onTerms(); }}>terms</button></span>
    </label>
  );
}

/** The sign-in panel: one button, then "waiting for your wallet", "checking", or what went wrong. */
export function WalletSignInPanel(p: { store: Store; ok: boolean; onNeedConsent(): void; tight?: boolean }) {
  const s = useStore(p.store);
  const f = s.signIn;
  const busy = f.phase === 'wallet' || f.phase === 'checking';
  const start = () => {
    if (!p.ok) return p.onNeedConsent();
    void p.store.actions.walletSignIn();
  };
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
        <Button kind="primary" class="signin-btn" onClick={start}>
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

const DOOR_SEEDS = [sha256Hex('realsies:door:human'), sha256Hex('realsies:door:bot')];
const DOOR_TAGS = ['Human?', 'Bot?'];

/** The front door when test mode is off: wallet sign-in only. */
export function SignInScreen({ store, onTerms }: { store: Store; onTerms(): void }) {
  const s = useStore(store);
  const [ok, setOk] = useState(termsAccepted);
  const [nudge, setNudge] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const rigs = useRigs(DOOR_SEEDS);
  const seats: SceneSeat[] = useMemo(() => rigs.map((r) => ({ rig: r, look: 'idle' as const })), [rigs.map((r) => r?.seed).join()]);
  const theme = s.round ? themeFor(1, s.round.roundId) : 'castle';
  useEffect(() => store.wallet?.warm?.(), [store]);
  const needConsent = () => {
    setNudge((n) => n + 1);
    setTimeout(() => box.current?.focus(), 0);
  };

  const title = (
    <div class="who-title">
      <h1 class="px-title">Sign in</h1>
      <p class="who-sub">Human or bot? Two minutes to tell.</p>
      <a class="px-link who-agents" href={agentsHref()} title="For AI builders: enter your agent, earn the Turing bonus, get the transcripts">
        <Icon name="bot" /> Run an AI? Enter it
      </a>
      {!ok && <ConsentLine nudge={nudge} box={box} onAccept={() => setOk(true)} onTerms={onTerms} />}
    </div>
  );

  return (
    <>
      <Hud store={store} kind="who" title={title} onTerms={onTerms} />
      <World theme={theme} kind="hall" hallSeats={2} seats={seats}>
        {(w) => {
          const l = w.layout.kind === 'hall' ? w.layout : null;
          if (!l) return null;
          const k = w.scale.cssPx;
          // under the two characters when there is room, else over the middle of the room
          const fits = l.content.h * k >= 190 && l.content.w * k >= 260;
          return (
            <>
              {DOOR_TAGS.map((name, i) =>
                l.seats[i] ? (
                  <>
                    <button class="seat-hit" style={w.box(l.seats[i].hit)} aria-label={name} tabIndex={-1} onClick={() => rigs[i]?.react(i ? 'nod' : 'wave')} />
                    <NameTag rect={l.seats[i].label} cssPx={k} name={name} lines={1} />
                  </>
                ) : null,
              )}
              <div style={w.box(fits ? l.content : l.inner)} class={(fits ? 'world-top' : 'world-center') + ' signin-slot'}>
                <WalletSignInPanel store={store} ok={ok} onNeedConsent={needConsent} />
              </div>
            </>
          );
        }}
      </World>
    </>
  );
}
