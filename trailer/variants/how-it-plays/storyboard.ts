// How it plays: one round of Realsies, played through and annotated, as data. Every shot, cursor
// move, message, caption and callout, in seconds from the first frame, on a calm 96 BPM grid. The
// scenes, the soundtrack, the contact sheet and script.md all read this file.

import { beatGrid, type Line, type Shot } from '../../src/engine/timeline.ts';
import type { ChatMsg, PlaythroughTimes, PersonaCard } from '../../src/scenes/promo/playthrough.ts';
import type { ThemeId } from '../../src/art.ts';
import { TAGLINE as TRAILER_TAGLINE, TAGLINE_ACCENT as TRAILER_ACCENT, URL_TEXT as TRAILER_URL } from '../for-realsies/storyboard.ts';

export const FPS = 24;
export const TITLE = 'Realsies: how it plays (annotated gameplay demo)';
export const THEME: ThemeId = 'space';
export const LEVEL = 'STAR STATION';

// ---------------------------------------------------------------- music grid

export const BPM = 96;
export const MUSIC_AT = 0;
const grid = beatGrid(BPM, MUSIC_AT);
export const BEAT = grid.beatLen;
/** Absolute time of a beat counted from the first frame. */
export const beat = grid.beat;

// ---------------------------------------------------------------- the round, timed

export const TIMES: PlaythroughTimes = {
  // the lobby: the cursor comes in, finds her, taps
  cursorIn: beat(1.2),
  hover: beat(3),
  click: beat(4),
  dialog: beat(5.5),
  // the seat dialog: 5 coins
  toCoins: beat(6.4),
  onCoins: beat(8),
  clickCoins: beat(9),
  close: beat(9.5),
  // the coins go on the table, matched
  placing: beat(9.5) + 0.12,
  matched: beat(11.4),
  // 3, 2, 1, CHAT! on the beat
  count3: beat(12),
  count2: beat(13),
  count1: beat(14),
  go: beat(15),
  doors: beat(15.5),
  // two minutes of chat in eleven seconds
  chatFrom: beat(16),
  chatTo: beat(33.6),
  // the call
  callFrom: beat(34),
  callCursorIn: beat(35),
  hoverYes: beat(36.5),
  hoverNo: beat(38.4),
  clickNo: beat(39.4),
  spinFrom: beat(40.4),
  spinTo: beat(41.7),
  // the round's results
  resultsFrom: beat(42),
  stamp: beat(43),
  right: beat(44),
  coinsFrom: beat(44.6),
  coinsTo: beat(45.8),
  toVerify: beat(51.6),
  clickVerify: beat(53.2),
  // the Verify drawer: seven checks pass one by one, then the verdict
  verifyFrom: beat(54),
  checks: [54.9, 55.3, 55.7, 56.1, 56.5, 56.9, 57.3].map(beat),
  verdict: beat(57.9),
};

const T = {
  lobby: 0,
  seat: TIMES.dialog,
  status: TIMES.placing,
  countdown: TIMES.count3,
  chat: TIMES.chatFrom,
  call: TIMES.callFrom,
  results: TIMES.resultsFrom,
  verify: TIMES.verifyFrom,
  end: beat(68),
  out: beat(78.4),
};

export const SHOTS: Shot[] = [
  {
    id: 'p01', kind: 'lobby', start: T.lobby, end: T.seat, key: beat(4.6),
    title: 'Lobby: pick a character',
    notes: 'Star Station, the trailer\'s room: ten characters idling on their pedestals with gamertags, the HUD with the round clock, coins (120), rating and calls. Caption 1, "Pick a character", and a callout over the room: "Some are people. Some are bots." The cursor comes in, hovers Acorn132 (her pedestal lights), clicks: the beam comes up, her tag turns yellow.',
  },
  {
    id: 'p02', kind: 'seat', start: T.seat, end: T.status, key: beat(8.6),
    title: 'Seat dialog: play 5 coins',
    notes: 'The room dims behind the seat dialog, drawn after web/src/screens/SeatDialog.tsx: her portrait on a lit pedestal, "Chat for two minutes with Acorn132", "Then make your call: real human, yes or no?", "Put coins on the table" with the 5, 10 and 25 presets and their dollar values, a custom amount, "Right calls share the coins of wrong ones", Play free. Caption 2, "Play coins". The cursor clicks 5.',
  },
  {
    id: 'p03', kind: 'status', start: T.status, end: T.countdown, key: beat(10.6),
    title: 'Coins on the table',
    notes: 'The chat screen before the chat: "Putting 5 coins on the table..." in the empty chat column, then "Matched! Getting ready...". The HUD reads CHAT 2:00, PLAYING 5.',
  },
  {
    id: 'p04', kind: 'countdown', start: T.countdown, end: T.chat, key: beat(13.3),
    title: '3, 2, 1, CHAT!',
    notes: 'The VS countdown on the beat, Ana against Acorn132 ("Real human?"), the doors fly apart onto the chat. No caption.',
  },
  {
    id: 'p05', kind: 'chat', start: T.chat, end: T.call, key: beat(31.5),
    title: 'The chat: two minutes',
    notes: 'Caption 3, "Chat for 2 minutes". The chat clock and the fuse run two minutes down in eleven seconds. Ana types into the input and sends; Acorn132 types (dots) and answers, double-texts, and lies in character. Seven messages, verbatim in the dialogue table.',
  },
  {
    id: 'p06', kind: 'call', start: T.call, end: T.results, key: beat(37.6),
    title: 'The call: Real human?',
    notes: 'Caption 4, "Call it: human or bot?". "Real human?" with its call clock; the cursor rests on YES, moves to NO, clicks. She shrugs. The locked panel: "You called Bot", "Locked until the round ends", the round clock, "Call on chain", Back to room. Caption: "Locked until the round ends". The round clock spins down to 0:00.',
  },
  {
    id: 'p07', kind: 'results', start: T.results, end: T.verify, key: beat(50),
    title: 'Round results: the reveal',
    notes: 'Caption 5, "Right calls share the coins of wrong calls". The results panel over the next round\'s room, after web/src/screens/Results.tsx: "Round 41 results", "You called 1 of 1 right", coins +5.29, rating 1032 to 1052. Acorn132 is stamped BOT (z-ai/glm-5.3-flash, entered by Acme Voice) with the persona card she was playing; "You called BOT", Right; +5.29 on 5 played, +20 rating, "9 paid calls, 63% said human". A callout on the room: "Turing bonus: 20% of the wrong coins go to the bot\'s builder". The cursor clicks Verify.',
  },
  {
    id: 'p08', kind: 'verify', start: T.verify, end: T.end, key: beat(60),
    title: 'Verify: the proof',
    notes: 'The Verify drawer slides in, after web/src/screens/Verify.tsx and web/src/verify/checks.ts: the first and last sentences of its intro (signed inside a NEAR AI enclave; nothing taken on trust); seven checks pass one by one (the enclave signer bound into the TDX report, the committed signers, the commitment rebuilt and its sha256, three replies whose signatures recover to the enclave signer), then "All 20 checks pass". Caption 6, "Every bot word is signed in a NEAR AI enclave", with the enclave and reply checks framed; then "Checked on NEAR at round end", with the commitment checks and the on-chain links framed.',
  },
  {
    id: 'p09', kind: 'end', start: T.end, end: T.out, key: beat(76.4), fadeOut: 0.5,
    title: 'End card: the trailer\'s',
    notes: 'The trailer\'s end card, beat for beat on this grid: the REALSIES logo drops in with its shine, the three rise in, smug; the trailer\'s tagline types on, realsies.lol pops in, the chime rings out.',
  },
];

export const DURATION = T.out;

// ---------------------------------------------------------------- what is said

/** The player and her messages (right, cyan); the character's (left, grey). */
export const CHAT: ChatMsg[] = [
  { from: 'me', text: "hey! how's your night going?", typeFrom: beat(16.6), at: beat(18.6) },
  { from: 'them', text: 'hi! on my break so I have like 2 min', typeFrom: beat(19.3), at: beat(21.1) },
  { from: 'me', text: 'what do you do?', typeFrom: beat(22), at: beat(23.2) },
  { from: 'them', text: 'im a nurse, night shifts this week', typeFrom: beat(23.8), at: beat(25.6) },
  { from: 'them', text: 'is it late there?', typeFrom: beat(26.2), at: beat(27.3) },
  { from: 'me', text: 'very. be honest, are you a bot?', typeFrom: beat(27.9), at: beat(29.8) },
  { from: 'them', text: 'lol no, just very tired', typeFrom: beat(30.4), at: beat(32.2) },
];

/** The chat as typed lines (ids for script.md and voice files; nothing is voiced). */
export const LINES: Line[] = CHAT.map((m, i) => ({
  id: `chat-${i + 1}`,
  speaker: m.from === 'me' ? 'host' : 'guest',
  text: m.text,
  at: m.from === 'me' ? m.typeFrom : m.at,
  // hers land whole after the dots
  cps: m.from === 'me' ? m.text.length / Math.max(0.2, m.at - m.typeFrom - 0.2) : 1000,
  lead: m.from === 'them' ? m.at - m.typeFrom : undefined,
}));

// ---------------------------------------------------------------- the reveal and the proof

export const PERSONA: PersonaCard = {
  name: 'Marta',
  facts: ['34', 'woman', 'ISFJ', 'tired', 'warm introvert', 'night-shift nurse in Porto, Portugal'],
  style: 'lowercase, a typo here and there, says haha',
  emoji: 'rare emoji',
};

/**
 * The room's paid calls on her (spec rules, web/src/net/mock/settle.ts): wrong, said human: 10, 25,
 * 5, 10 and 25 coins; right, said bot: Ana's 5, and 10, 5 and 25. 5% of each play goes to the bot
 * fund first, so W = 71.25 and R = 42.75 locked coins. Ana gets her 4.75 back plus 0.7 x 71.25 x
 * 4.75 / 42.75 = 5.54: +5.29 on her 5. The builder's Turing bonus is 0.2 x 71.25 = 14.25, the game
 * keeps 7.13. 62.5% of the paid coins said human (shown 63%); her rating moves +round(32 x 0.625).
 */
export const RESULT = {
  coinsDelta: 4.75 + (0.7 * 71.25 * 4.75) / 42.75 - 5,
  ratingDelta: Math.round(32 * (1 - 42.75 / 114)),
  paidCalls: 9,
  saidHuman: 71.25 / 114,
  links: [['reveal', '4QFY...xFJ1'], ['open', '7USm...YVaR'], ['settle', '3NwR...QqSQ']] as [string, string][],
};

/**
 * The Verify drawer: the first and last sentences of its intro, and three of its eight check groups
 * with labels as web/src/verify/checks.ts writes them (the Commitment group carries the commitment
 * section's note and links). With three replies the full drawer runs 20 checks.
 */
export const VERIFY = {
  intro: ['Every bot reply was signed inside a NEAR AI enclave.', 'Nothing on this page is taken on trust from the game.'],
  total: 20,
  groups: [
    {
      title: 'Enclave',
      checks: [
        { label: 'Signer 0x3b753b4406... bound into the TDX report data' },
        { label: 'Committed signers are the attested ones' },
      ],
    },
    {
      title: 'Commitment',
      checks: [
        { label: 'Commitment string rebuilt from the opening' },
        { label: 'sha256(commitment string) is the committed hash' },
      ],
      note: 'Put on chain at round start, before any play counted. Opened at round end.',
      links: [['commit', '9Hk2...Wq7c'], ['open', '7USm...YVaR'], ['settle', '3NwR...QqSQ']] as [string, string][],
    },
    {
      title: 'Every reply',
      checks: [
        { label: 'Reply 1: hashes match, signature recovers to the enclave' },
        { label: 'Reply 2: hashes match, signature recovers to the enclave' },
        { label: 'Reply 3: hashes match, signature recovers to the enclave', detail: 'signer 0x3b753b4406613c5e70ae640508632b600424fa0c' },
      ],
    },
  ],
};

// ---------------------------------------------------------------- annotations

export interface Caption {
  step?: number;
  text: string;
  from: number;
  to: number;
}

export const CAPTIONS: Caption[] = [
  // up from the first frame, so the first frame reads on its own
  { step: 1, text: 'Pick a character', from: -2, to: T.seat },
  { step: 2, text: 'Play coins', from: T.seat, to: T.countdown },
  { step: 3, text: 'Chat for 2 minutes', from: TIMES.doors, to: T.call },
  { step: 4, text: 'Call it: human or bot?', from: T.call, to: TIMES.clickNo + 0.2 },
  { step: 4, text: 'Locked until the round ends', from: TIMES.clickNo + 0.2, to: T.results },
  { step: 5, text: 'Right calls share the coins of wrong calls', from: T.results, to: T.verify },
  { step: 6, text: 'Every bot word is signed in a NEAR AI enclave', from: T.verify, to: beat(61.6) },
  { step: 6, text: 'Checked on NEAR at round end', from: beat(61.6), to: T.end },
];

/** The callouts, and which verify groups each proof caption frames. */
export const NOTES = {
  people: { text: 'Some are people. Some are bots.', from: -2, to: T.seat },
  turing: { lines: ['Turing bonus:', '20% of the wrong coins', "go to the bot's builder"], from: beat(47), to: TIMES.toVerify + 0.6 },
  signed: { groups: [0, 2], from: beat(55.2), to: beat(61.6) },
  chain: { groups: [1], from: beat(61.6), to: T.end },
};

// ---------------------------------------------------------------- end card (the trailer's)

/** End-card beats on this grid, the trailer's spacing: logo, URL, chime, shine sweeps, the nod, the push, the eyebrow. */
export const END = {
  logo: 68,
  url: 74,
  chime: 76,
  glints: [69, 74, 76],
  nod: [70.5, 71.25] as [number, number],
  push: [71.6, 71.8, 72.6, 73.15] as [number, number, number, number],
  brow: 73.5,
};

export const TAGLINE_ACCENT = TRAILER_ACCENT;
export const URL_TEXT = TRAILER_URL;
export const TAGLINE: Line = { id: 'tagline', speaker: 'tagline', text: TRAILER_TAGLINE.text, at: beat(END.logo + 1.5), cps: 30 };
LINES.push(TAGLINE);
