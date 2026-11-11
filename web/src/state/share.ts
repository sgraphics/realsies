// Sharing a call (growth plan P2): after a reveal the player can post what happened, with a link whose preview is
// the card for that outcome. The link goes to a static page (web/public/s/<outcome>/index.html, written by
// scripts/share-pages.mjs from the texts below) that carries the preview tags and sends a visitor on into the game;
// the cards are rendered by trailer/scripts/share-cards.ts. Nothing about the player or the chat is in the link.
//
// On a phone the system's own share sheet opens (the player picks X, Telegram, WhatsApp...); elsewhere a new tab with
// the post ready on X.

export type ShareOutcome = 'fooled' | 'spotted' | 'found' | 'missed';

export const SHARE_OUTCOMES: readonly ShareOutcome[] = ['fooled', 'spotted', 'found', 'missed'];

/** The card's big line, and the title of the link's preview. */
export const SHARE_TITLE: Record<ShareOutcome, string> = {
  fooled: 'A bot fooled me',
  spotted: 'I spotted the bot',
  found: 'I found the human',
  missed: 'I took a human for a bot',
};

/** What the post says; the link follows it. */
export const SHARE_TEXT: Record<ShareOutcome, string> = {
  fooled: 'A bot just fooled me on Realsies. Two minutes of chat, and I called it human. Can you tell who is real?',
  spotted: 'I spotted the bot on Realsies after two minutes of chat. Can you tell who is real?',
  found: 'I found the real human on Realsies after two minutes of chat. Can you tell who is real?',
  missed: 'I took a real human for a bot on Realsies. Can you tell who is real?',
};

export const SHARE_ORIGIN = 'https://realsies.lol';

/** Which card a call gets: what the partner was and whether the call was right; null for no call. */
export function shareOutcome(truth: 'human' | 'bot', right: boolean | null): ShareOutcome | null {
  if (right === null) return null;
  if (truth === 'bot') return right ? 'spotted' : 'fooled';
  return right ? 'found' : 'missed';
}

/** The trailing slash matters: the static page is the folder's index. */
export function shareUrl(o: ShareOutcome): string {
  return `${SHARE_ORIGIN}/s/${o}/`;
}

export function xIntentUrl(o: ShareOutcome): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(SHARE_TEXT[o])}&url=${encodeURIComponent(shareUrl(o))}`;
}

interface ShareEnv {
  navigator?: { share?(data: { text: string; url: string }): Promise<void> };
  matchMedia?(q: string): { matches: boolean };
  open?(url: string, target: string, features: string): unknown;
}

/** A touch device with a share sheet. A desktop browser's own sheet is a poor place to post from: there, X. */
export function hasShareSheet(env: ShareEnv = globalThis as ShareEnv): boolean {
  return typeof env.navigator?.share === 'function' && typeof env.matchMedia === 'function' && env.matchMedia('(pointer: coarse)').matches;
}

/** Opens the share sheet or the post on X; says which. A sheet the player closed is 'cancelled', not a failure. */
export async function share(o: ShareOutcome, env: ShareEnv = globalThis as ShareEnv): Promise<'shared' | 'cancelled' | 'opened'> {
  if (hasShareSheet(env)) {
    try {
      await env.navigator!.share!({ text: SHARE_TEXT[o], url: shareUrl(o) });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
      // a sheet that failed for another reason: the post on X instead
    }
  }
  env.open?.(xIntentUrl(o), '_blank', 'noopener');
  return 'opened';
}
