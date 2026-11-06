// How it plays: an annotated gameplay demo for the X thread, the serious sibling of the launch
// trailer. One round in the trailer's Star Station room: pick a character, play 5 coins, the 3-2-1,
// a two-minute chat with a bot, the call, the round's results and the Verify drawer, each step named
// by a lower-third caption; then the trailer's own end card. This file binds the storyboard to the
// promo scenes (src/scenes/promo/) and to the trailer's end card and cast.

import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rgba } from '../../src/art.ts';
import { castLook } from '../../src/engine/actor.ts';
import { tc } from '../../src/engine/scriptmd.ts';
import type { Shot } from '../../src/engine/timeline.ts';
import type { TrailerDef } from '../../src/engine/types.ts';
import { HeroEndCard } from '../../src/scenes/endcard.ts';
import { Playthrough, type Screen } from '../../src/scenes/promo/playthrough.ts';
import { P, shadeBand, caption, callout, calloutSize, highlight } from '../../src/scenes/promo/ui.ts';
import { textW } from '../../src/scenes/promo/text.ts';
import * as S from './storyboard.ts';
import { CAST, TAGS, GUEST_SEAT, ME, END_SEATS, lobbySeeds } from '../for-realsies/cast.ts';
import { soundtrack } from './sound.ts';

const DIR = dirname(fileURLToPath(import.meta.url));
const NAME = basename(DIR);

/** The character the player taps: Acorn132, bottom row, second from the left. */
const PICK = 6;

let built: { play: Playthrough; end: HeroEndCard } | null = null;
function scenes() {
  if (built) return built;
  const seeds = lobbySeeds();
  built = {
    play: new Playthrough({
      theme: S.THEME,
      level: S.LEVEL,
      tags: TAGS,
      seeds,
      lookSeat: { seat: GUEST_SEAT, look: () => castLook(CAST.guest) },
      pick: PICK,
      me: ME,
      presets: [5, 10, 25],
      usdPerCoin: 0.01,
      balance: 120,
      play: 5,
      rating: 1032,
      roundLeft: 8 * 60 + 52,
      roundNo: 41,
      callSeconds: 15,
      chat: S.CHAT,
      bubbles: { k: 6, wrap: 112 },
      truth: 'bot',
      model: 'z-ai/glm-5.3-flash',
      botmaster: 'Acme Voice',
      persona: S.PERSONA,
      result: S.RESULT,
      verify: S.VERIFY,
      times: S.TIMES,
    }),
    // the trailer's end card: its tagline, URL and trio, timed on this grid
    end: new HeroEndCard({
      tagline: S.TAGLINE,
      accent: S.TAGLINE_ACCENT,
      url: S.URL_TEXT,
      trio: { left: seeds[END_SEATS.left], mid: castLook(CAST.guest), right: seeds[END_SEATS.right] },
      beat: S.beat,
      beats: { logo: S.END.logo, url: S.END.url, chime: S.END.chime, glints: S.END.glints, nod: S.END.nod, push: S.END.push, brow: S.END.brow },
    }),
  };
  return built;
}

/** Captions, callouts and frames over a game screen. */
function annotate(out: Rgba, kind: string, t: number): void {
  const play = scenes().play;
  const a = play.anchors;
  if (kind === 'countdown') return;
  shadeBand(out, 892, 1080);
  for (const c of S.CAPTIONS) caption(out, c, t);
  // over the lobby: the premise
  const people = S.NOTES.people;
  if (kind === 'lobby') {
    const sz = calloutSize({ lines: [people.text], scale: 5 });
    callout(out, { lines: [people.text], x: 960 - sz.w / 2, y: 128, from: people.from, until: people.to, scale: 5, rim: P.gold }, t);
  }
  // on the results: the Turing bonus, pointing at the room's split
  if (kind === 'results') {
    const n = S.NOTES.turing;
    const sz = calloutSize({ lines: n.lines, scale: 4 });
    callout(out, { lines: n.lines, x: 1884 - sz.w, y: a.saidHuman.y - sz.h / 2, to: { x: a.saidHuman.x, y: a.saidHuman.y }, side: 'left', from: n.from, until: n.to, scale: 4, rim: P.gold }, t);
  }
  // on the proof: frame what each caption names
  if (kind === 'verify') {
    for (const note of [S.NOTES.signed, S.NOTES.chain]) {
      if (t < note.from || t >= note.to) continue;
      const on = Math.floor((t - note.from) / 0.12) % 2 === 0 || t - note.from > 0.5;
      if (!on) continue;
      for (const g of note.groups) {
        const r = a.verifyGroups[g];
        if (r) highlight(out, r.x, r.y, r.w, r.h, P.gold, 8, 6);
      }
    }
  }
}

function drawer(): (out: Rgba, shot: Shot, t: number) => void {
  const sc = scenes();
  return (out, shot, t) => {
    if (shot.kind === 'end') {
      sc.end.render(out, t);
      return;
    }
    sc.play.render(out, shot.kind as Screen, t);
    annotate(out, shot.kind, t);
  };
}

// ---------------------------------------------------------------- script.md prose

const script: TrailerDef['script'] = {
  heading: 'Realsies: how it plays (annotated gameplay demo)',
  summary: 'A reply to the launch trailer: one round of the game, played through at the game\'s own scale and named step by step in plain captions, more serious than the trailer. The room, characters, pedestals, fuse, countdown art, icons and end card are the art engine\'s and the trailer\'s; the app\'s DOM layer (HUD, seat dialog, chat bubbles, call panel, results, Verify drawer) is redrawn in the trailer\'s pixel font after web/src/screens, a little larger than the app so it reads on a phone. The numbers on the results follow the settlement rules (web/src/net/mock/settle.ts) for the room described in storyboard.ts; the check labels are the ones web/src/verify/checks.ts writes. Nothing here is footage; no character is modelled on a real person.',
  framing: `Framing: every game screen is the game at 1080p (4 px per game pixel under a 64-px HUD) on the Star Station theme, the trailer's lobby and cast. A dithered dark band holds the lower-third captions (a gold step chip, one line of white pixel type, typed on); callouts are dark boxes with a gold rim and a pointer; gold frames mark what a caption names. The chat column ends above the band (the app's runs to the frame), and the chat clock runs its two minutes in ${(S.TIMES.chatTo - S.TIMES.chatFrom).toFixed(1)} seconds (${tc(S.TIMES.chatFrom)} to ${tc(S.TIMES.chatTo)}), the round clock with it.`,
  dialogueNote: 'The chat, as typed: Ana\'s messages type into the input and go out as cyan bubbles on the right; the character\'s come in as grey bubbles on the left after her typing dots. Nothing is voiced. The character is a bot playing Marta, one of the app\'s demo personas (web/src/net/mock/personas.ts), in her own words.',
  dialogueAfter: `On screen as captions: ${S.CAPTIONS.map((c) => `"${c.text}"`).join(', ')}. Callouts: "${S.NOTES.people.text}" over the lobby; "Turing bonus: 20% of the wrong coins go to the bot's builder" on the results.`,
  sound: [
    `A calm bed at ${S.BPM} BPM from the trailer's synth kit, in A minor going round Am, F, C, G: a soft detuned pulse pad, a 12.5% pulse arpeggio in eighths, a stepped triangle bass, quiet hats from the second bar, a soft kick from the chat on; a slow heartbeat and no hats while the call is made; a short pulse lead over the reveal and the proof; F, G into C for the end card with a kick and snare lift.`,
    'The game\'s sounds on every action: cursor ticks and clicks, the pedestal lighting up, the coin, the countdown beeps and doors, soft key clicks as Ana types and as the character\'s dots run, a chirp out and a two-note blip in for each message, time\'s up, the lock on the call, the round clock spinning down, the reveal\'s thump, three rising blips for Right, the coins counting up, a rising blip for each check that passes and a soft chord for the verdict.',
    `End card (${tc(S.beat(S.END.logo))}): the trailer's cues on this grid: a coin as the logo lands, the whoosh of the three rising, a shing on each sweep of the shine, the ting off the sunglasses, the eyebrow's bwip, the URL's pop and the final chime at ${tc(S.beat(S.END.chime))}.`,
    'Mix: synthesised at 48 kHz, peak-limited, then two-pass loudnorm (I -14, TP -1.5, linear).',
  ],
  cast: [
    `The trailer's Star Station lobby and gamertags (variants/for-realsies/cast.ts). The player is Ana (seed \`${ME.seed}\`). The character is Acorn132 (lobby seat ${PICK + 1}), a bot entered by "Acme Voice" (the app's demo builder) running z-ai/glm-5.3-flash, playing the persona Marta.`,
    'End card: the trailer\'s trio and tagline, unchanged.',
  ],
  who: { host: 'Ana (player)', guest: 'Acorn132 (bot)', tagline: 'End card' },
  unrecorded: 'Nothing is voiced: the chat is text, as in the game.',
};

export const trailer: TrailerDef = {
  name: NAME,
  title: S.TITLE,
  video: 'how-it-plays.mp4',
  fps: S.FPS,
  duration: S.DURATION,
  shots: S.SHOTS,
  lines: S.LINES,
  dir: DIR,
  drawer,
  poster: (out) => drawer()(out, S.SHOTS.find((s) => s.kind === 'results')!, S.NOTES.turing.from + 1.5),
  soundtrack,
  onScreen: (line) => {
    const i = S.LINES.indexOf(line);
    const m = S.CHAT[i];
    if (!m) return undefined;
    return { from: m.typeFrom, until: S.TIMES.callFrom };
  },
  script,
};

export default trailer;

void textW;
