// The testnet airdrop (protocol v1.6): 100 test tokens in one tap, on the testnet demo only (a relay in test
// mode on testnet). A wallet player's land in the wallet, and from there everything works as on mainnet (tap
// your coins, deposit, play); a test player's go straight into the game balance. The relay allows one per account
// per 10 minutes and none while the account holds 50 or more (wallet plus game balance). The TESTNET panel shows
// only while the player holds nothing at all, in the wallet or in the game; once tokens land it is gone and a short
// note says where they are. The words on screen and the panel's face live here, so screens and tests agree.

import { AIRDROP, type AirdropStatus, type PublicConfig } from '../../../shared/protocol.ts';
import type { AppState } from './store.ts';
import { fmtCoins } from './format.ts';

export interface AirdropView {
  phase: 'idle' | 'busy' | 'error';
  /** the relay's view for this account; null: none to be had here (an older relay, or it did not answer) */
  status?: AirdropStatus | null;
  error?: { code: string; text: string };
}

export const AIRDROP_IDLE: AirdropView = { phase: 'idle' };

/** Only on the testnet demo: test mode on testnet, with the coin open. Never on mainnet. */
export function airdropOn(cfg: PublicConfig | undefined): boolean {
  return !!cfg?.testMode && cfg.network === 'testnet' && cfg.coinsOpen !== false;
}

export function airdropLabel(symbol: string, coins: number = AIRDROP.coins): string {
  return `Airdrop ${coins} ${symbol} test tokens`;
}

export const TESTNET_LINE = 'free test tokens, no real money';
export const NO_ACTION = 'No further action needed.';

/** What lands where, said in the panel before the tap (a test player's go straight into the game). */
export function beforeNote(to: 'wallet' | 'game' | undefined): string {
  return to === 'game' ? `Straight into your game balance. ${NO_ACTION}` : NO_ACTION;
}

/** The note once they landed (the panel is gone by then): where they are, and the one next step. */
export function landedNote(to: 'wallet' | 'game', coins: number, symbol: string): string {
  return to === 'wallet'
    ? `${coins} ${symbol} are in your wallet. Tap your coins to deposit, then play.`
    : `${coins} ${symbol} are in your game balance. Tap a character to play.`;
}

/** The wait for the next one, while the account holds nothing (one per account per 10 minutes). */
export function waitText(nextAt: number, now = Date.now()): string {
  const mins = Math.max(1, Math.ceil((nextAt - now) / 60_000));
  return `One airdrop every ${AIRDROP.everyMinutes} minutes. The next one opens in ${mins} min.`;
}

/** The reason an airdrop did not happen; the relay's refusal codes first. */
export function airdropErrorText(code: string, e: unknown, st: AirdropStatus | null | undefined, symbol: string, now = Date.now()): string {
  const data = (e as { data?: { retryAt?: number; heldCoins?: number } } | null)?.data;
  switch (code) {
    case 'airdrop_too_soon': {
      const at = data?.retryAt ?? st?.nextAt;
      return waitText(at && at > now ? at : now + AIRDROP.everyMinutes * 60_000, now);
    }
    case 'airdrop_enough': {
      const held = data?.heldCoins ?? st?.heldCoins;
      const start = held !== undefined ? `You hold ${fmtCoins(held)} ${symbol} already` : 'You hold enough already';
      return `${start}. Airdrops are for balances under ${AIRDROP.enoughCoins} ${symbol}.`;
    }
    case 'faucet_failed':
      return 'The airdrop did not go through. Try again in a minute.';
    case 'rpc_unavailable':
      return 'NEAR is not answering right now. Try again in a minute.';
    case 'unauthorized':
    case 'session_expired':
      return 'Sign in again to get the airdrop.';
    case 'not_test_mode':
      return 'The airdrop is for the testnet demo only.';
    case 'coins_closed':
      return 'Coins are not open yet.';
    default:
      return e instanceof Error && e.message ? e.message : 'The airdrop did not go through. Try again in a minute.';
  }
}

/** A refusal by the limits: trying again right away cannot help. */
export function airdropRefused(code: string | undefined): boolean {
  return code === 'airdrop_too_soon' || code === 'airdrop_enough' || code === 'not_test_mode' || code === 'coins_closed';
}

/** Any tREAL at all, in the wallet or in the game (coins on the table count): the TESTNET panel is not needed. */
export function holdsAny(s: Pick<AppState, 'me' | 'airdrop'>): boolean {
  if ((s.me?.balanceCoins ?? 0) > 0 || (s.me?.lockedCoins ?? 0) > 0) return true;
  return (s.airdrop.status?.heldCoins ?? 0) > 0;
}

/** The account holds what the limits call enough (wallet plus game balance): no airdrop to offer. */
export function holdsEnough(st: AirdropStatus | null | undefined): boolean {
  return !!st && st.heldCoins >= st.enoughCoins;
}

export type PanelMode = 'none' | 'offer' | 'busy' | 'wait' | 'error';

/**
 * Which face of the TESTNET panel shows: in the room only, and only while the player holds nothing (wallet and
 * game both empty; the relay's view first, so it never flashes up). The offer (one big button), the moment it
 * runs, the wait for the next one, or what went wrong. Anything held: none at all.
 */
export function panelMode(s: Pick<AppState, 'config' | 'accountId' | 'airdrop' | 'me'>, kind: 'lobby' | 'chat' | 'call' | 'who', now = Date.now()): PanelMode {
  if (kind !== 'lobby' || !s.accountId || !airdropOn(s.config)) return 'none';
  const a = s.airdrop;
  if (!a.status || holdsAny(s)) return 'none';
  if (a.phase === 'busy') return 'busy';
  if (a.phase === 'error' && !airdropRefused(a.error?.code)) return 'error';
  // the relay said too soon, and the time it named has not come yet (then the offer is back)
  if (a.status.blocked === 'airdrop_too_soon' && a.status.nextAt > now) return 'wait';
  return 'offer';
}
