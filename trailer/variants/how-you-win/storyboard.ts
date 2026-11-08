// How you win: the scoring video as data. Slow, one thing at a time, winning cases only: an AI bot
// you call right on your own, then a real human you call right alongside another player (a shared
// win). The amounts come from the game's rules (src/scenes/promo/howwin.ts).

import { lookFromSeed, MOUTHS, HAIRS, PAL, type Look } from '../../src/art.ts';
import { idx } from '../../src/engine/actor.ts';
import type { Shot } from '../../src/engine/timeline.ts';
import type { Run } from '../../src/scenes/promo/text.ts';
import { type Case, T, settle, fmt } from '../../src/scenes/promo/howwin.ts';

export const FPS = 24;
export const TITLE = 'Realsies: How you win (scoring)';
/** The chest's label (asked for as "Pool"; the product's own word would be "Coins"). */
export const CHEST_LABEL = 'POOL';

// ---------------------------------------------------------------- cast

/** You: the player from the launch trailer's countdown (dark bob, headphones, orange sweater). */
export const youLook = (): Look => lookFromSeed('me-120');
/** The real human: the beret and the afro from the Plug in clip. */
export const humanLook = (): Look => lookFromSeed('f2fa82747a4332921f4499f64ae639d91f63b5e223f3cebd7371ea79c12070bf');
/** The AI bot: the launch trailer's guest, with her big blue eyes. */
export function botLook(): Look {
  const l = lookFromSeed('guest-17375');
  l.mouth = idx(MOUTHS, 'line');
  l.hair = idx(HAIRS, 'wavy');
  l.ramps.hair = 'rust';
  l.ramps.skin = 'skin2';
  l.front = -1;
  return l;
}

// ---------------------------------------------------------------- the two cases

export const CASES: Case[] = [
  {
    truth: 'bot',
    callers: [
      { name: 'YOU', call: 'bot', play: 10 },
      { name: 'Player 2', call: 'human', play: 10, seed: '3448e6da6965d623048d59e3040076a36e4d402e5d52a2eaa94301cf294904a3' },
      { name: 'Player 3', call: 'human', play: 10, seed: 'f1a67590017c7d4b91e6d326d6fcf34ebbf443abbe8836531139bb94f0bd56c8' },
    ],
  },
  {
    truth: 'human',
    callers: [
      { name: 'YOU', call: 'human', play: 10 },
      { name: 'Player 2', call: 'bot', play: 25, seed: 'f8089a8bbbc9229547b46a7fe5feb3484bc1fe4d0b38d749e409fa7dafeb39d6' },
      { name: 'Player 3', call: 'human', play: 10, seed: 'cf4bd9d0b5d6c6a1ef844fd060e393125a8ed316b4d28d5f67ae5e00c2f18b5d' },
    ],
  },
];

export const OUTRO_LINES: Run[][] = [
  [{ text: 'Call it right.' }],
  [{ text: 'Win the coins of wrong calls.', color: PAL.gold }],
];

// ---------------------------------------------------------------- timing

/** The first case holds on the title and you before your partner comes in: the first frame matters. */
export const HOLD = 2.25;
export const TITLE_LINES: [string, string] = ["Guess if you're chatting", 'with AI or a human'];
/** Shot starts, and the moment each case's own clock starts (the first one after the hold). */
export const STARTS = CASES.map((_c, i) => (i === 0 ? 0 : HOLD + i * T.len));
export const CASE_T0 = CASES.map((_c, i) => HOLD + i * T.len);
export const OUTRO_AT = HOLD + CASES.length * T.len;
export const OUTRO = 3.5;
export const DURATION = OUTRO_AT + OUTRO;

const callWord = (s: string) => (s === 'human' ? 'I think you are human' : 'I think you are a bot');

export const SHOTS: Shot[] = [
  ...CASES.map((c, i): Shot => {
    const s = settle(c);
    const [you, a, b] = c.callers;
    return {
      id: `s0${i + 1}`,
      kind: `case${i}`,
      start: STARTS[i],
      end: CASE_T0[i] + T.len,
      key: CASE_T0[i] + T.len - 0.6,
      title: `Case ${i + 1}: ${c.truth === 'bot' ? 'an AI bot' : 'a real human'}, you call it right`,
      notes: `${i === 0 ? `First frame, held ${HOLD} s: "${TITLE_LINES.join(' ')}" big over the scene, and you, large in the bottom-right corner, labelled YOU, with "Your character" pointing at you. ` : ''}You stand large in the bottom-right corner. Your partner slides in from the left labelled ${c.truth === 'bot' ? 'AI BOT' : 'REAL HUMAN'}. You say "${callWord(you.call)}" and your ${you.play} coins fly into the chest (${CHEST_LABEL}). ${a.name} slides in from the right: "${callWord(a.call)}", ${a.play} coins in. Then ${b.name}: "${callWord(b.call)}", ${b.play} coins. ROUND REVEAL: "Your partner was ${c.truth === 'bot' ? 'an AI bot' : 'a real human'}". The table of calls with ticks and crosses; the coins of the wrong rows move to the right rows: ${c.callers.map((k, j) => `${k.name} ${fmt(s.net[j])}`).join(', ')}. WIN ${fmt(s.net[0])} coins over you.`,
    };
  }),
  { id: 's03', kind: 'outro', start: OUTRO_AT, end: DURATION, key: DURATION - 0.4, title: 'Outro', notes: `The logo with a shine. "${OUTRO_LINES.map((l) => l.map((r) => r.text).join('')).join(' ')}" realsies.lol.` },
];
