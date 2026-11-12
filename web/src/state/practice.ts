// The practice chat (protocol v1.14): free tries for a visitor without a wallet (PublicConfig.practice.perDay a day),
// each a chat with a house bot outside the rounds and the reveal right after the call. This browser keeps a random
// device id (the relay counts tries per device and per IP) and how many it had today, so "Before you play" knows at
// once when they are used. The words of the try live here, in one place.

import type { PracticeRefusal, PublicConfig, Seat } from '../../../shared/protocol.ts';
import { BOTS_NAPPING } from './notices.ts';

const DEVICE_KEY = 'realsies:device';
const TRIED_KEY = 'realsies:practice';

/** The room's hint for a guest while a try is left (Lobby.tsx); with none left it says "Tap anyone to chat". */
export const HINT_FREE = "Tap anyone to chat. It's free: no wallet needed";
/** The terms step's button and the choice after the terms; the wallet's way under it; the one plain line when there is no try. */
export const TRY_FREE = 'Start free chat';
export const WALLET_LINK = 'I have a NEAR wallet: sign in';
export const PRACTICE_USED = "You've had your free chats for today.";
export const PRACTICE_CAP = 'The free chats are all gone for today.';
/** The reveal (PracticeResult.tsx). */
export const REVEAL_TITLE = 'That was a bot';
export const SPOTTED = 'You spotted it';
export const FOOLED = 'It fooled you';
export const NO_CALL = 'No call in time';
export const INVITE = 'Real rounds have real people and coins. Sign in with a wallet to play them.';
export const PLAY_AGAIN = 'Play again';
/** Where to follow the game: under the reveal's invite, and at the bottom of the room's menu. */
export const TELEGRAM_URL = 'https://t.me/realsieslol';
export const X_URL = 'https://x.com/realsieslol';

/** Every refusal the relay gives a try (the code of a refused POST, and GET /api/practice's reason). */
export const REFUSALS: readonly PracticeRefusal[] = ['practice_used', 'practice_cap', 'practice_off', 'bots_unavailable', 'beta_closed'];

function ls(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** This browser's device id: random, made once, kept. Private mode: one for this page. */
let memoryId: string | null = null;
export function deviceId(): string {
  try {
    const have = ls()?.getItem(DEVICE_KEY);
    if (have && /^[A-Za-z0-9_-]{16,64}$/.test(have)) return have;
  } catch {
    /* fall through */
  }
  if (!memoryId) {
    const b = new Uint8Array(18);
    crypto.getRandomValues(b);
    memoryId = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  try {
    ls()?.setItem(DEVICE_KEY, memoryId);
  } catch {
    /* private mode */
  }
  return memoryId;
}

/** Tries this browser had today (UTC, as the relay counts). */
function triedCount(now: number): number {
  try {
    const v = JSON.parse(ls()?.getItem(TRIED_KEY) ?? 'null') as { day?: string; n?: number } | null;
    return v && v.day === utcDay(now) && typeof v.n === 'number' ? v.n : 0;
  } catch {
    return 0;
  }
}

/** This browser had its tries today (`perDay` of them). */
export function triedToday(perDay = 1, now = Date.now()): boolean {
  return triedCount(now) >= Math.max(1, perDay);
}

/** The relay reserved a try for this browser (it counts from that moment), or said this device or network had it. */
export function markTried(now = Date.now(), all = false, perDay = 1): void {
  try {
    ls()?.setItem(TRIED_KEY, JSON.stringify({ day: utcDay(now), n: all ? Math.max(1, perDay) : triedCount(now) + 1 }));
  } catch {
    /* private mode: the relay still knows */
  }
}

/** QA and tests: a first visit again. */
export function forgetPractice(): void {
  try {
    ls()?.removeItem(TRIED_KEY);
  } catch {
    /* ignore */
  }
}

/** The free try is on at this relay (and the beta is not over). */
export function practiceOn(cfg: PublicConfig | undefined): boolean {
  return !!cfg?.practice && cfg.practice.perDay > 0 && !cfg.betaClosed;
}

/** On here, and this browser has a try left today (the relay may still say no: its IP count, the day's cap). */
export function tryLeft(cfg: PublicConfig | undefined, now = Date.now()): boolean {
  return practiceOn(cfg) && !triedToday(cfg?.practice?.perDay, now);
}

/** "Play again": another open character of the room, never the one just played (at random); none left: undefined. */
export function againSeat(seats: readonly Seat[], playedSeed: string, rnd: () => number = Math.random): Seat | undefined {
  const others = seats.filter((x) => x.state === 'open' && x.skin.seed !== playedSeed);
  return others[Math.floor(rnd() * others.length)];
}

/**
 * The one plain line that says why there is no try. None when the free try is simply not on here, or the beta is over
 * (the app's own note says so).
 */
export function refusalLine(reason: PracticeRefusal | undefined): string | null {
  if (reason === 'practice_used') return PRACTICE_USED;
  if (reason === 'practice_cap') return PRACTICE_CAP;
  if (reason === 'bots_unavailable') return BOTS_NAPPING;
  return null;
}
