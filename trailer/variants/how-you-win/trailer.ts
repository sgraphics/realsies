// How you win: the scoring video for X. Slow and step by step, winning cases only: your partner
// slides in labelled, you call, everyone's coins go into the chest, the round is revealed, the table
// shows the coins moving from wrong calls to right ones, and you win.

import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rgba } from '../../src/art.ts';
import type { Shot } from '../../src/engine/timeline.ts';
import type { TrailerDef } from '../../src/engine/types.ts';
import { HowWinScene, settle, fmt, RULES } from '../../src/scenes/promo/howwin.ts';
import * as S from './storyboard.ts';
import { soundtrack } from './sound.ts';

const DIR = dirname(fileURLToPath(import.meta.url));
const NAME = basename(DIR);

let scene: HowWinScene | null = null;
const sc = () =>
  (scene ??= new HowWinScene({
    you: S.youLook(),
    partners: { human: { look: S.humanLook() }, bot: { look: S.botLook(), bigEyes: true } },
    chestLabel: S.CHEST_LABEL,
    title: 'How you win',
  }));

function drawer(): (out: Rgba, shot: Shot, t: number) => void {
  const s = sc();
  return (out, shot, t) => {
    if (shot.kind === 'outro') return s.outro(out, t - shot.start, S.OUTRO_LINES);
    s.render(out, S.CASES[Number(shot.kind.slice(4))], t - shot.start);
  };
}

const results = S.CASES.map((c, i) => {
  const s = settle(c);
  const who = c.truth === 'bot' ? "the bot's builder" : 'the human';
  return `Case ${i + 1} (${c.truth}): ` + c.callers.map((k, j) => `${k.name} plays ${k.play} and calls ${k.call}: ${fmt(s.net[j])}`).join('; ') + `. ${who} earns ${s.bonus.toFixed(2)} (Turing bonus), the game ${s.game.toFixed(2)}.`;
});

const script: TrailerDef['script'] = {
  heading: 'Realsies: "How you win", the scoring video',
  summary: `About ${Math.round(S.DURATION)} seconds for X, slow and one step at a time, winning cases only. You stand large in the bottom-right corner, the way your side of a chat sits; your partner slides in from the left with a label instead of a name (AI BOT or REAL HUMAN). You say your call and your coins fly into a treasure chest labelled ${S.CHEST_LABEL}; two more players slide in from the right and add theirs. ROUND REVEAL, then a small table of everyone's calls, where the coins of the wrong rows move to the right rows, and WIN over you. The amounts come from the game's rules in code: ${RULES.fee * 100}% of a play to the bot fund, then the coins of wrong calls split ${RULES.right * 100}% to the right callers by the coins they played, ${RULES.character * 100}% to the character (the Turing bonus), ${RULES.game * 100}% to the game.`,
  framing: 'Framing: one 1920x1080 layout. You and your partner at 20 px per game pixel, waist on the bottom edge; the other two players small (7 px) in the upper right; the chest in the top centre. Results:\n\n' + results.map((r) => '- ' + r).join('\n'),
  dialogueNote: 'No voice: the calls are speech bubbles on screen.',
  sound: [
    'A chiptune bed at 120 BPM (C, G, Am, F): a 12.5% pulse arpeggio, a stepped triangle bass, a soft kick and hats.',
    'Each case: a whoosh as your partner slides in, a chirp for each call, coins clinking into the chest, a glitch (bot) or a warm ping (human) on ROUND REVEAL, ticks as the marks land, coins moving across the table, a crash and the chime on WIN.',
    'Mix: synthesised at 48 kHz, peak-limited, two-pass `loudnorm` to -14 LUFS.',
  ],
  cast: [
    'You: seed `me-120`, the player from the launch trailer (dark bob, headphones, orange sweater).',
    "The AI bot: the launch trailer's guest (her eyes light up cyan at the reveal). The real human: the beret and afro from the Plug in clip. The other players: seeded random looks.",
  ],
  unrecorded: 'There are no lines to record.',
};

export const trailer: TrailerDef = {
  name: NAME,
  title: S.TITLE,
  video: 'realsies-how-you-win.mp4',
  fps: S.FPS,
  duration: S.DURATION,
  shots: S.SHOTS,
  lines: [],
  dir: DIR,
  drawer,
  poster: (out) => drawer()(out, S.SHOTS[0], S.STARTS[0] + 11.5),
  soundtrack,
  script,
};
