// How you win: the scoring video for X. You and a partner side by side, all four cases (a human or a
// bot partner, called human or bot), and the big one: a bot that fooled nine in ten, seen through.

import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rgba } from '../../src/art.ts';
import type { Shot } from '../../src/engine/timeline.ts';
import type { TrailerDef } from '../../src/engine/types.ts';
import { ScoringScene, outcome, fmtNet, RULES } from '../../src/scenes/promo/scoring.ts';
import * as S from './storyboard.ts';
import { soundtrack } from './sound.ts';

const DIR = dirname(fileURLToPath(import.meta.url));
const NAME = basename(DIR);

let scene: ScoringScene | null = null;
const sc = () =>
  (scene ??= new ScoringScene({
    you: S.youLook(),
    partners: { human: { look: S.humanLook() }, bot: { look: S.botLook(), bigEyes: true } },
    title: 'How you win',
  }));

function drawer(): (out: Rgba, shot: Shot, t: number) => void {
  const s = sc();
  return (out, shot, t) => {
    if (shot.kind === 'intro') return s.intro(out, t - shot.start, S.INTRO_LINES);
    if (shot.kind === 'outro') return s.outro(out, t - shot.start, S.OUTRO_LINES, S.OUTRO_FOOT);
    const i = Number(shot.kind.slice(4));
    s.scenario(out, S.SCENARIOS[i], i + 1, S.SCENARIOS.length, t - shot.start);
  };
}

const results = S.SCENARIOS.map((c, i) => {
  const o = outcome(c);
  return `Case ${i + 1}: a ${c.truth} partner, the room ${c.others.human} human / ${c.others.bot} bot, you play ${c.play} and call ${c.call}: ${o.right ? 'right' : 'wrong'}, ${fmtNet(o.net)} coins${o.right ? ` (${o.onCall} on the call after the fee, a share of ${o.reward.toFixed(2)} from the wrong side)` : ''}.`;
});

const script: TrailerDef['script'] = {
  heading: 'Realsies: "How you win", the scoring video',
  summary: `About ${Math.round(S.DURATION)} seconds for X: how the coins move after a call. You stand on the left, your chat partner on the right as a "???" until the reveal, and the room's calls on that partner as a bar above you both. All four cases: a human partner you call human, then bot; a bot partner you call human, then bot. The amounts come from the game's rules in code (${RULES.fee * 100}% of a play to the bot fund, then the wrong calls' coins split ${RULES.right * 100}% to the right callers by the coins they played, ${RULES.character * 100}% to the character as the Turing bonus, ${RULES.game * 100}% to the game), and the cases build to the big one: a bot that fooled nine in ten, seen through. Drawn with the Realsies art engine and the promo toolkit; no footage or audio from anywhere else.`,
  framing: 'Framing: one 1920x1080 layout throughout. The characters are drawn at 12 px per game pixel, waist up behind a dark crest; the bar, tags, bubble and numbers use the trailer\'s pixel font and the game\'s UI kit. Results by case:\n\n' + results.map((r) => '- ' + r).join('\n'),
  dialogueNote: 'No voice: the text is on screen.',
  sound: [
    'A chiptune bed at 120 BPM (C, G, Am, F): a 12.5% pulse arpeggio, a stepped triangle bass, a soft kick and hats.',
    "On every case: a sweep as the room's bar draws, a chirp for your call, a coin as yours joins the room, the reveal (a glitch and a shine for a bot, a warm ping for a human), a rising arpeggio for RIGHT or a falling buzz for WRONG, coins landing, the counter ticking.",
    'The big win adds a crash and the chime; the outro rings the chime again and fades out.',
    'Mix: synthesised at 48 kHz, peak-limited, two-pass `loudnorm` to -14 LUFS.',
  ],
  cast: [
    'You: seed `me-120`, the player from the launch trailer (dark bob, headphones, orange sweater).',
    'The human partner: the beret and afro from the Plug in clip. The bot partner: the launch trailer\'s guest, whose eyes light up cyan when she is revealed as a bot.',
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
  poster: (out) => drawer()(out, S.SHOTS[4], S.STARTS[3] + 4.2),
  soundtrack,
  script,
};
