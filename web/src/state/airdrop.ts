// The testnet airdrop (protocol v1.6): 100 test tokens in one tap, on the testnet demo only (a relay in test
// mode on testnet). A wallet player's land in the wallet, and from there everything works as on mainnet (tap
// your coins, deposit, play); a test player's go straight into the game balance. The relay allows one per account
// per 10 minutes and none while the account holds 50 or more (wallet plus game balance). The words on screen
// and which face of the TESTNET panel shows live here, so the panel, the coins screens and the tests agree.

import { AIRDROP, type AirdropStatus, type PublicConfig } from '../../../shared/protocol.ts';
import type { AppState } from './store.ts';
import { fmtCoins } from './format.ts';

export interface AirdropView {
  phase: 'idle' | 'busy' | 'done' | 'error';
  /** the relay's view for this account; null: none to be had here (an older relay, or it did not answer) */
  status?: AirdropStatus | null;
  /** the airdrop that just landed, while its message shows */
  landed?: { tx: string; coins: number; to: 'wallet' | 'game' };
  error?: { code: string; text: string };
  /** the panel folded into the slim TESTNET tag (kept per account in this browser) */
  folded: boolean;
}

export const AIRDROP_IDLE: AirdropView = { phase: 'idle', folded: false };

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

export function landedText(to: 'wallet' | 'game', coins: number, symbol: string): string {
  return to === 'wallet' ? `${coins} ${symbol} are in your wallet.` : `${coins} ${symbol} are in your game balance.`;
}

export function landedNext(to: 'wallet' | 'game'): string {
  return to === 'wallet'
    ? 'From here it works like the real game: tap your coins to deposit, then play.'
    : 'From here it works like the real game: tap a character and play.';
}

/** The reason an airdrop did not happen, for the panel; the relay's refusal codes first. */
export function airdropErrorText(code: string, e: unknown, st: AirdropStatus | null | undefined, symbol: string, now = Date.now()): string {
  const data = (e as { data?: { retryAt?: number; heldCoins?: number } } | null)?.data;
  switch (code) {
    case 'airdrop_too_soon': {
      const at = data?.retryAt ?? st?.nextAt;
      const mins = at && at > now ? Math.max(1, Math.ceil((at - now) / 60_000)) : AIRDROP.everyMinutes;
      return `One airdrop every ${AIRDROP.everyMinutes} minutes. The next one opens in ${mins} min.`;
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

export type PanelMode = 'none' | 'offer' | 'busy' | 'done' | 'error' | 'tag';

/**
 * Which face of the TESTNET panel shows. In the room: the offer (one big button) while an airdrop is open and the
 * panel was not folded in this browser; the message once it landed; the reason when it was refused; else the slim
 * tag. In a chat or a call: always the slim tag (the HUD hides it in a chat on a phone).
 */
export function panelMode(s: Pick<AppState, 'config' | 'accountId' | 'airdrop'>, kind: 'lobby' | 'chat' | 'call' | 'who'): PanelMode {
  if (kind === 'who' || !s.accountId || !airdropOn(s.config)) return 'none';
  if (kind !== 'lobby') return 'tag';
  const a = s.airdrop;
  if (a.phase !== 'idle') return a.phase;
  if (a.folded || !a.status || a.status.blocked) return 'tag';
  return 'offer';
}

/** The account holds what the limits call enough (wallet plus game balance): no airdrop to offer, now or later. */
export function holdsEnough(st: AirdropStatus | null | undefined): boolean {
  return !!st && st.heldCoins >= st.enoughCoins;
}

/** The slim tag offers "Airdrop again" only while the account holds little (wallet plus game balance). */
export function offerAgain(st: AirdropStatus | null | undefined): boolean {
  return !!st && st.heldCoins < st.againBelowCoins;
}

const FOLD_KEY = (account: string) => `realsies:airdrop:folded:${account}`;

function ls(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function readFolded(account: string): boolean {
  try {
    return ls()?.getItem(FOLD_KEY(account)) === '1';
  } catch {
    return false;
  }
}

export function writeFolded(account: string): void {
  try {
    ls()?.setItem(FOLD_KEY(account), '1');
  } catch {
    /* private mode: folded until the page reloads */
  }
}
