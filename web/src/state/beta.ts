// The testnet beta's end (PublicConfig.betaClosed, protocol v1.9): the relay's NEAR AI spend reached its cap
// (BETA_SPEND_CAP_USD). No new chats or sign-ins (error beta_closed) and no new rounds; running chats finish. The
// game shows one calm full-width note, then, 5 s later and once no chat of the player is running, goes to the
// relay's redirect with ?beta=over. The page that opens there (the launch page, or the game) says thank you in one
// line and takes the parameter out of the address.

import type { AppState } from './store.ts';

export const BETA_OVER = 'The beta test is over. Thanks for playing! See you on mainnet.';
export const BETA_OVER_LANDING = 'The testnet beta is over. Thanks for testing!';
export const BETA_REDIRECT_MS = 5000;
export const DEFAULT_BETA_REDIRECT = 'https://realsies.lol';

/** Where the game goes: the redirect (absolute, or relative to `base`) with ?beta=over, other parameters kept. */
export function betaOverUrl(redirect: string | undefined, base?: string): string {
  let u: URL | null = null;
  try {
    u = new URL(redirect || DEFAULT_BETA_REDIRECT, base);
  } catch {
    u = null;
  }
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) u = new URL(DEFAULT_BETA_REDIRECT);
  u.searchParams.set('beta', 'over');
  return u.toString();
}

/** An address opened with ?beta=over: the thank-you, and the same address without the parameter. */
export function takeBetaOver(href: string): { notice: boolean; url: string } {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return { notice: false, url: href };
  }
  if (u.searchParams.get('beta') !== 'over') return { notice: false, url: href };
  u.searchParams.delete('beta');
  return { notice: true, url: u.pathname + u.search + u.hash };
}

/** In the browser: was this page opened with ?beta=over? The parameter leaves the address either way. */
export function consumeBetaOver(): boolean {
  const loc = (globalThis as { location?: Location }).location;
  if (!loc?.href) return false;
  const t = takeBetaOver(loc.href);
  if (t.notice) {
    try {
      history.replaceState(history.state, '', t.url);
    } catch {
      /* the notice still shows */
    }
  }
  return t.notice;
}

/** The beta's end as the game sees it: the relay's config says so, or a beta_closed error came first. */
export function betaEndOf(s: Pick<AppState, 'config' | 'betaOver'>): { redirect?: string } | null {
  if (s.config?.betaClosed) return { redirect: s.config.betaClosed.redirect };
  if (s.betaOver) return {};
  return null;
}

/** A chat of the player still runs (placing, chatting or its call window): the redirect waits for it. */
export function chatRunning(s: Pick<AppState, 'chat'>): boolean {
  const p = s.chat?.phase;
  return p === 'placing' || p === 'chatting' || p === 'calling';
}
