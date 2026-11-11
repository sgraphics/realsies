// "Bot or human?": a clip from one transcript file (chats/*.json), as data. Reads the transcript, checks it, and times
// the clip on a 96 BPM grid: the hook, the chat (each line typed or announced by typing dots, then held long enough
// to read), the pause on the beat (3, 2, 1), the reveal, the end card. The scene (src/scenes/promo/botorhuman.ts), the
// soundtrack (sound.ts) and the render script (scripts/bot-or-human.ts) all read the plan made here.
//
// A transcript holds the whole chat, word for word, and marks the lines the clip leaves out with "skip": lines may be
// dropped for length, never reworded or reordered. The bot's lines are real model output. Format:
//   {
//     "about": "where the chat comes from",
//     "source": { "kind": "practice" | "round", "chatId": "...", "played": "2026-11-11", ... },
//     "theme": "space",                      the room (castle, jungle, desert, cave, space); default space
//     "partner": { "name": "Cinder481", "seed": "<64 hex>" },   the gamertag and the look (a Rig seed)
//     "coins": 0,                            0 = a free chat; else the coins played
//     "lines": [ { "t": 73.0, "from": "me" | "them", "text": "...", "skip": true }, ... ],   t: seconds into the chat
//     "verdict": "bot" | "human",
//     "model": "z-ai/glm-5.3-flash",         a bot's model
//     "persona": { "name", "age", "gender", "mbti", "temperament", "job", "home", ... },   a bot's card, as revealed
//     "note": "..."                          a human's line under the stamp (optional)
//   }

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { beatGrid, type Shot } from '../../src/engine/timeline.ts';
import type { ClipMsg, ClipTimes, RevealCard } from '../../src/scenes/promo/botorhuman.ts';
import { THEME_NAMES, THEMES, type ThemeId } from '../../../shared/protocol.ts';

export const FPS = 24;
export const BPM = 96;
const grid = beatGrid(BPM, 0);
export const BEAT = grid.beatLen;
export const beat = grid.beat;

/** The clip's own words (the game's vocabulary: play, coins, call, reward, rating). */
export const TEXT = {
  hook: 'Bot or human?',
  pause: 'Human or bot?',
  titleBot: 'That was a bot',
  titleHuman: 'That was a human',
  proofBot: 'Every bot message is signed in a NEAR AI enclave',
  question: "Can you tell who's real?",
  url: 'realsies.lol',
  free: 'First chat is free',
};

/** Words the clip never shows (token words). */
const BANNED = /\b(bets?|betting|stakes?|staking|odds|wagers?|pools?|markets?|prices?)\b/i;

export interface TranscriptLine {
  t?: number;
  from: 'me' | 'them';
  text: string;
  skip?: boolean;
}

export interface Transcript {
  about?: string;
  source?: Record<string, unknown>;
  theme?: ThemeId;
  partner: { name: string; seed: string };
  coins?: number;
  lines: TranscriptLine[];
  verdict: 'bot' | 'human';
  model?: string;
  persona?: RevealCard & Record<string, unknown>;
  note?: string;
}

export interface Plan {
  name: string;
  file: string;
  transcript: Transcript;
  theme: ThemeId;
  level: string;
  chat: ClipMsg[];
  /** Real chat seconds at clip times (for the chat clock): [clip t, chat t] pairs, rising. */
  clockKeys: [number, number][];
  times: ClipTimes;
  duration: number;
  shots: Shot[];
  /** What the log should say about the text (characters the pixel font draws differently, and so on). */
  notes: string[];
}

// ---------------------------------------------------------------- reading and checking

/** The glyphs the pixel fonts draw (engine/font.ts and the promo extras in src/scenes/promo/text.ts). */
const DRAWABLE = /^[A-Za-z0-9 .,?!'"\-:/()_…%+=<>#*$;[\]|·→✓×−–’]*$/u;

/**
 * Typography the pixel font has no glyph for, drawn as its plain form: curly quotes, dashes, accents (é as e). The
 * words stay the same; this only changes how a character is drawn. Anything else (emoji, other scripts) is refused,
 * so a line the font cannot draw gets "skip" rather than a silent change.
 */
export function forFont(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—]/g, '-')
    .replace(/ /g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function readTranscript(file: string): Transcript {
  const tr = JSON.parse(readFileSync(file, 'utf8')) as Transcript;
  const fail = (why: string) => {
    throw new Error(`${basename(file)}: ${why}`);
  };
  if (!tr.partner || typeof tr.partner.name !== 'string' || !/^[0-9a-zA-Z:_-]{4,}$/.test(String(tr.partner.seed))) fail('partner needs a name and a seed');
  if (tr.verdict !== 'bot' && tr.verdict !== 'human') fail('verdict must be "bot" or "human"');
  if (tr.theme !== undefined && !THEMES.includes(tr.theme)) fail(`theme must be one of ${THEMES.join(', ')}`);
  if (!Array.isArray(tr.lines) || !tr.lines.length) fail('no lines');
  for (const [i, l] of tr.lines.entries()) {
    if (l.from !== 'me' && l.from !== 'them') fail(`line ${i + 1}: from must be "me" or "them"`);
    if (typeof l.text !== 'string' || !l.text.trim()) fail(`line ${i + 1}: empty`);
  }
  const shown = tr.lines.filter((l) => !l.skip);
  if (shown.length < 2 || shown.length > 8) fail(`the clip shows ${shown.length} lines; keep 4 to 7 (mark the others "skip": true)`);
  if (!shown.some((l) => l.from === 'them')) fail('the clip shows none of the partner\'s lines');
  for (const l of shown) {
    const drawn = forFont(l.text);
    if (!DRAWABLE.test(drawn)) fail(`the pixel font cannot draw ${JSON.stringify(l.text)} (${[...drawn].filter((ch) => !DRAWABLE.test(ch)).join(' ')}); mark it "skip": true`);
  }
  return tr;
}

// ---------------------------------------------------------------- timing

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const onBeat = (t: number) => Math.ceil(t / BEAT - 1e-6) * BEAT;
/** Longest and shortest clip, in seconds. */
export const MAX_S = 25;
export const MIN_S = 15;

/** Time the chat: typing, dots and reading holds, scaled by `pace` (1 = normal, less = faster). */
function timeChat(lines: { from: 'me' | 'them'; text: string }[], from: number, pace: number): { chat: ClipMsg[]; end: number } {
  const chat: ClipMsg[] = [];
  let cur = from;
  lines.forEach((l, i) => {
    const n = l.text.length;
    const last = i === lines.length - 1;
    const prev = lines[i - 1];
    if (l.from === 'me') {
      const typing = clamp(n / 32, 0.35, 1.2) * pace;
      const at = cur + typing + 0.12;
      chat.push({ from: 'me', text: l.text, typeFrom: cur, at });
      cur = at + clamp(0.25 + n * 0.015, 0.45, 0.9) * pace;
    } else {
      // a second bubble in a row comes quicker, as a double text does
      const dots = (prev?.from === 'them' ? 0.35 : 0.4 + Math.min(0.4, n * 0.01)) * Math.max(0.85, pace);
      const at = cur + dots;
      chat.push({ from: 'them', text: l.text, typeFrom: cur, at });
      cur = at + clamp(0.45 + n * 0.04, 0.8, 2.4) * pace + (last ? 0.45 : 0);
    }
  });
  return { chat, end: cur };
}

export function planClip(file: string): Plan {
  const tr = readTranscript(file);
  const name = basename(file).replace(/\.json$/i, '');
  const notes: string[] = [];
  const shown = tr.lines.filter((l) => !l.skip);
  if (shown.length < 4 || shown.length > 7) notes.push(`the clip shows ${shown.length} lines; 4 to 7 read best`);
  const lines = shown.map((l) => {
    const text = forFont(l.text.trim());
    if (text !== l.text.trim()) notes.push(`drawn in the pixel font as ${JSON.stringify(text)}: ${JSON.stringify(l.text)}`);
    return { from: l.from, text, t: l.t };
  });
  for (const l of lines) if (l.from === 'me' && BANNED.test(l.text)) notes.push(`a token word in the player's line ${JSON.stringify(l.text)}`);
  const theme: ThemeId = tr.theme ?? 'space';

  const hookTo = beat(2);
  const chatFrom = hookTo + 0.3;
  // fixed parts after the chat: the pause (4 beats), the reveal (7), the end card (5)
  const tail = (end: number) => onBeat(end) + beat(4 + 7 + 5);
  let pace = 1;
  let timed = timeChat(lines, chatFrom, pace);
  while (tail(timed.end) > MAX_S && pace > 0.7) {
    pace -= 0.05;
    timed = timeChat(lines, chatFrom, pace);
  }
  if (tail(timed.end) > MAX_S) throw new Error(`${name}: the chat is too long for ${MAX_S} s even at a fast pace; mark more lines "skip": true`);
  if (pace < 1) notes.push(`the chat runs at ${Math.round(pace * 100)}% of its reading pace to fit ${MAX_S} s`);
  // a short chat: hold the reveal longer so the clip is at least MIN_S
  const chatTo = onBeat(timed.end);
  const extra = Math.max(0, Math.ceil((MIN_S - tail(timed.end)) / BEAT));
  const pauseFrom = chatTo;
  const revealFrom = pauseFrom + beat(4);
  const endFrom = revealFrom + beat(7 + extra);
  const times: ClipTimes = {
    hookTo,
    chatTo,
    count: [pauseFrom + beat(1), pauseFrom + beat(2), pauseFrom + beat(3)],
    revealFrom,
    stamp: revealFrom + beat(0.5),
    card: revealFrom + beat(2),
    proof: revealFrom + beat(3.5),
    endFrom,
    url: endFrom + beat(1),
    free: endFrom + beat(2),
    out: endFrom + beat(5),
  };
  const duration = Math.round(times.out * FPS) / FPS;

  // the chat clock: the real chat's seconds where the transcript has them, else evenly through two minutes
  const real = lines.map((l, i) => (typeof l.t === 'number' ? l.t : ((i + 1) / (lines.length + 1)) * 115));
  const clockKeys: [number, number][] = [[hookTo, Math.max(0, real[0] - 4)]];
  timed.chat.forEach((m, i) => clockKeys.push([m.at, Math.max(clockKeys[clockKeys.length - 1][1], real[i])]));
  clockKeys.push([chatTo, Math.min(120, Math.max(clockKeys[clockKeys.length - 1][1] + 2, 120))]);

  const msg = (i: number) => timed.chat[i];
  const lastThem = [...timed.chat].reverse().find((m) => m.from === 'them')!;
  const shots: Shot[] = [
    { id: 'hook', kind: 'hook', start: 0, end: hookTo, key: 0.3, title: TEXT.hook, notes: 'The hook over the chat room.' },
    { id: 'chat-a', kind: 'chat', start: hookTo, end: chatTo, key: msg(Math.min(2, timed.chat.length - 1)).at + 0.5, title: 'The chat', notes: 'Early in the chat.' },
    { id: 'chat-b', kind: 'chat', start: hookTo, end: chatTo, key: lastThem.typeFrom + 0.2, title: 'Typing dots', notes: 'The last line, dots first.' },
    { id: 'chat-c', kind: 'chat', start: hookTo, end: chatTo, key: chatTo - 0.15, title: 'The chat, last line', notes: 'Everything said.' },
    { id: 'pause', kind: 'pause', start: chatTo, end: revealFrom, key: times.count[0] + 0.3, title: TEXT.pause, notes: '3, 2, 1.' },
    { id: 'reveal', kind: 'reveal', start: revealFrom, end: endFrom, key: endFrom - 0.2, title: 'The reveal', notes: 'The stamp, the card, the proof.' },
    { id: 'end', kind: 'end', start: endFrom, end: duration, key: duration - 0.6, title: 'End card', notes: 'The question, the URL, the first chat free.' },
  ];
  return { name, file, transcript: tr, theme, level: THEME_NAMES[theme].toUpperCase(), chat: timed.chat, clockKeys, times, duration, shots, notes };
}

/** Seconds left on the chat clock at clip time t. */
export function clockAt(p: Plan, t: number): number {
  const k = p.clockKeys;
  if (t <= k[0][0]) return 120 - k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) {
      const u = (t - k[i - 1][0]) / Math.max(1e-6, k[i][0] - k[i - 1][0]);
      return 120 - (k[i - 1][1] + (k[i][1] - k[i - 1][1]) * u);
    }
  }
  return 0;
}

/** The reveal card (the fields the clip shows), from a transcript's persona. */
export function revealCard(tr: Transcript): RevealCard | undefined {
  const p = tr.persona;
  if (!p) return undefined;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? forFont(v.trim()) : undefined);
  return { name: s(p.name), age: typeof p.age === 'number' ? p.age : undefined, gender: s(p.gender), mbti: s(p.mbti), temperament: s(p.temperament), job: s(p.job), home: s(p.home) };
}
