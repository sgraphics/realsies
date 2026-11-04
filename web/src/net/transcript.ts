// The player's own copy of each chat, kept in localStorage while the chat runs, so the Verify
// drawer can prove that the bot's words in the signed requests are the ones shown on this screen.

import type { ChatMessage } from '../../../shared/protocol.ts';

export interface StoredLine {
  id: string;
  from: 'me' | 'them';
  text: string;
  at: number;
}

const KEY = (chatId: string) => `realsies:transcript:${chatId}`;

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export function loadTranscript(chatId: string): StoredLine[] | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY(chatId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as StoredLine[]) : null;
  } catch {
    return null;
  }
}

/** Append one message (deduplicated by id) to the stored copy. */
export function saveTranscriptMessage(chatId: string, msg: ChatMessage): void {
  const s = storage();
  if (!s) return;
  try {
    const cur = loadTranscript(chatId) ?? [];
    if (cur.some((l) => l.id === msg.id)) return;
    cur.push({ id: msg.id, from: msg.from, text: msg.text, at: msg.at });
    s.setItem(KEY(chatId), JSON.stringify(cur));
  } catch {
    /* quota or privacy mode: the check will show "no local copy" */
  }
}

/** Swap an optimistic local entry (id "local-N") for the relay's echo of it. */
export function replaceTranscriptMessage(chatId: string, oldId: string, msg: ChatMessage): void {
  const s = storage();
  if (!s) return;
  try {
    const cur = loadTranscript(chatId) ?? [];
    const i = cur.findIndex((l) => l.id === oldId);
    if (cur.some((l) => l.id === msg.id)) {
      if (i >= 0) cur.splice(i, 1);
    } else if (i >= 0) cur[i] = { id: msg.id, from: msg.from, text: msg.text, at: msg.at };
    else cur.push({ id: msg.id, from: msg.from, text: msg.text, at: msg.at });
    s.setItem(KEY(chatId), JSON.stringify(cur));
  } catch {
    /* ignore */
  }
}

/** Drop an entry the relay rejected (rate limit, too long). */
export function removeTranscriptMessage(chatId: string, id: string): void {
  const s = storage();
  if (!s) return;
  try {
    const cur = (loadTranscript(chatId) ?? []).filter((l) => l.id !== id);
    s.setItem(KEY(chatId), JSON.stringify(cur));
  } catch {
    /* ignore */
  }
}

export function clearTranscript(chatId: string): void {
  try {
    storage()?.removeItem(KEY(chatId));
  } catch {
    /* ignore */
  }
}
