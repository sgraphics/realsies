// How you win: the scoring video as data. YOU and a partner side by side, the room's calls on the
// partner, and all four cases: a human partner you call human or bot, a bot partner you call human
// or bot. The amounts come from the game's rules (src/scenes/promo/scoring.ts), built up to the
// big one: a bot that fooled nine in ten, seen through, +63 coins on a 10-coin play.

import { lookFromSeed, MOUTHS, HAIRS, type Look } from '../../src/art.ts';
import { idx } from '../../src/engine/actor.ts';
import type { Shot } from '../../src/engine/timeline.ts';
import type { Run } from '../../src/scenes/promo/text.ts';
import { type Scenario, outcome, fmtNet } from '../../src/scenes/promo/scoring.ts';
import { PAL } from '../../src/art.ts';

export const FPS = 24;
export const TITLE = 'Realsies: How you win (scoring)';

// ---------------------------------------------------------------- cast

/** You: the player from the launch trailer's countdown (dark bob, headphones, orange sweater). */
export const youLook = (): Look => lookFromSeed('me-120');
/** The human partner: the beret and the afro from the Plug in clip. */
export const humanLook = (): Look => lookFromSeed('f2fa82747a4332921f4499f64ae639d91f63b5e223f3cebd7371ea79c12070bf');
/** The bot partner: her, the launch trailer's guest, with her big blue eyes. */
export function botLook(): Look {
  const l = lookFromSeed('guest-17375');
  l.mouth = idx(MOUTHS, 'line');
  l.hair = idx(HAIRS, 'wavy');
  l.ramps.hair = 'rust';
  l.ramps.skin = 'skin2';
  l.front = -1;
  return l;
}

// ---------------------------------------------------------------- the four cases

const PLAY = 10;
export const SCENARIOS: Scenario[] = [
  {
    truth: 'human', call: 'human', play: PLAY, others: { human: 750, bot: 190 },
    caption: [[{ text: 'Right, but so was most of the room.' }], [{ text: 'Easy calls pay a little.' }]],
  },
  {
    truth: 'human', call: 'bot', play: PLAY, others: { human: 750, bot: 190 },
    caption: [[{ text: 'They were human. Your coins go to' }], [{ text: 'the people who called it right.' }]],
  },
  {
    truth: 'bot', call: 'human', play: PLAY, others: { human: 950, bot: 90 },
    caption: [[{ text: 'Fooled by a bot. Its builder earns' }], [{ text: '20% of your coins: a Turing bonus.' }]],
  },
  {
    truth: 'bot', call: 'bot', play: PLAY, others: { human: 950, bot: 90 },
    caption: [[{ text: '9 in 10 got fooled. You share their coins' }], [{ text: 'with the few who saw it.' }]],
  },
];

const BIG = fmtNet(outcome(SCENARIOS[3]).net); // "+63"

export const INTRO_LINES: Run[][] = [
  [{ text: `${PLAY} coins in. ` }, { text: `${BIG.slice(1)} out?`, color: PAL.gold }],
  [{ text: 'Human or bot: here is how calls pay.' }],
];
export const OUTRO_LINES: Run[][] = [
  [{ text: 'Right calls share the coins of wrong calls.' }],
  [{ text: 'See what the room missed: ' }, { text: 'win big.', color: PAL.gold }],
];
export const OUTRO_FOOT = '5% of every play funds the bots; the amounts include it.';

// ---------------------------------------------------------------- timing

export const INTRO = 2.5;
/** Each case's length; the big one holds longer. */
export const LEN = [5.25, 5.25, 5.25, 6.25];
export const OUTRO = 4.5;
export const STARTS = LEN.reduce<number[]>((a, _l, i) => [...a, i === 0 ? INTRO : a[i - 1] + LEN[i - 1]], []);
export const OUTRO_AT = STARTS[3] + LEN[3];
export const DURATION = OUTRO_AT + OUTRO;

const label = (s: Scenario) => `${s.truth === 'bot' ? 'A bot' : 'A human'}, you call ${s.call}`;

export const SHOTS: Shot[] = [
  { id: 's01', kind: 'intro', start: 0, end: INTRO, key: 2.0, title: 'Intro: the hook', notes: `You and a stranger, a "???" over their head. "${PLAY} coins in. ${BIG.slice(1)} out?" and "Human or bot: here is how calls pay."` },
  ...SCENARIOS.map((s, i): Shot => {
    const o = outcome(s);
    return {
      id: `s0${i + 2}`,
      kind: `case${i}`,
      start: STARTS[i],
      end: STARTS[i] + LEN[i],
      key: STARTS[i] + 4.2,
      title: `Case ${i + 1}: ${label(s)}`,
      notes: `The room's calls on the partner: HUMAN ${s.others.human}, BOT ${s.others.bot} coins. You play ${s.play} coins and say "${s.call === 'human' ? 'Human!' : 'Bot!'}"; your coins join that side. The partner is revealed: ${s.truth.toUpperCase()}${s.truth === 'bot' ? ' (the eyes light up cyan)' : ''}. ${o.right ? 'RIGHT!' : 'WRONG'} ${fmtNet(o.net)} coins. ${o.right ? 'Coins fly from the wrong side to you.' : 'Your coins fly off: 70% to the right callers, 20% to the partner, 10% to the game.'} Caption: "${s.caption.map((l) => l.map((r) => r.text).join('')).join(' ')}"`,
    };
  }),
  { id: 's06', kind: 'outro', start: OUTRO_AT, end: DURATION, key: DURATION - 0.5, title: 'Outro: the rule and the address', notes: `The logo with a shine. "${OUTRO_LINES.map((l) => l.map((r) => r.text).join('')).join(' ')}" realsies.lol. Small print: "${OUTRO_FOOT}"` },
];
