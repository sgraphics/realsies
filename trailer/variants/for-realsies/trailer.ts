// For realsies?: the launch trailer. A deadpan 8-bit parody of a prestige-documentary interview
// teaser (her "I'm always for realsies", his "you're for realsies?", a glitch in her eyes), then
// the game, then the smug three on the hero end card. This file binds the variant's storyboard,
// cast and sound to the reusable scenes.

import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rgba } from '../../src/art.ts';
import { castLook } from '../../src/engine/actor.ts';
import { ChatOverlay } from '../../src/engine/chat.ts';
import { tc } from '../../src/engine/scriptmd.ts';
import type { Shot } from '../../src/engine/timeline.ts';
import type { TrailerDef } from '../../src/engine/types.ts';
import type { VoiceEnvelopes } from '../../src/engine/audio/voice.ts';
import { InterviewScene } from '../../src/scenes/interview/interview.ts';
import { blackCard, typedCard } from '../../src/scenes/cards.ts';
import { GameMontage } from '../../src/scenes/montage.ts';
import { HeroEndCard } from '../../src/scenes/endcard.ts';
import * as S from './storyboard.ts';
import { CAST, GUEST_BIG_EYES, TAGS, GUEST_SEAT, ME, END_SEATS, lobbySeeds } from './cast.ts';
import { soundtrack } from './sound.ts';

/** The variant is named after its folder, so a copy (npm run new) is a new variant as is. */
const DIR = dirname(fileURLToPath(import.meta.url));
const NAME = basename(DIR);

// ---------------------------------------------------------------- scenes, bound to the storyboard

let built: { interview: InterviewScene; chat: ChatOverlay; montage: GameMontage; end: HeroEndCard } | null = null;
function scenes() {
  if (built) return built;
  const seeds = lobbySeeds();
  built = {
    interview: new InterviewScene({
      cast: CAST,
      guestBigEyes: GUEST_BIG_EYES,
      direction: S.DIRECTION,
      blink: S.BLINK,
      lines: S.LINES,
      fps: S.FPS,
      glitch: { frame: S.GLITCH_FRAME, frames: S.GLITCH.length },
    }),
    chat: new ChatOverlay({ theme: S.THEME, lines: S.CHAT, away: S.CHAT_AWAY, k: S.BUBBLES.k, wrap: S.BUBBLES.interviewWrap }),
    montage: new GameMontage({
      theme: S.THEME,
      level: 'STAR STATION',
      tags: TAGS,
      seeds,
      guestSeat: GUEST_SEAT,
      guestLook: () => castLook(CAST.guest),
      me: ME,
      chat: S.CHAT_LINES,
      bubbles: { k: S.BUBBLES.k, wrap: S.BUBBLES.montageWrap },
      cues: S.CUE,
      beat: S.beat,
      beatLen: S.BEAT,
      chatBeat: S.CHAT_BEAT,
      callBeat: S.CALL_BEAT,
    }),
    end: new HeroEndCard({
      tagline: S.TAGLINE,
      accent: S.TAGLINE_ACCENT,
      url: S.URL_TEXT,
      trio: { left: seeds[END_SEATS.left], mid: castLook(CAST.guest), right: seeds[END_SEATS.right] },
      beat: S.beat,
      beats: { logo: S.CUE.logo, url: S.CUE.url, chime: S.CUE.chime, glints: S.END.glints, nod: S.END.nod, push: S.END.push, brow: S.END.brow },
    }),
  };
  return built;
}

function drawer(voice?: VoiceEnvelopes): (out: Rgba, shot: Shot, t: number) => void {
  const sc = scenes();
  return (out, shot, t) => {
    switch (shot.kind) {
      case 'black':
        blackCard(out);
        break;
      case 'set':
        sc.interview.drawShot(out, shot, t, voice, sc.chat);
        break;
      case 'card':
        typedCard(out, t, S.CARD_LINE, shot.start);
        break;
      case 'end':
        sc.end.render(out, t);
        break;
      default:
        sc.montage.render(out, shot.kind as 'lobby' | 'countdown' | 'chat' | 'call', t);
    }
  };
}

// ---------------------------------------------------------------- script.md prose

const script: TrailerDef['script'] = {
  heading: 'Realsies launch trailer: "For realsies?"',
  summary: 'A deadpan parody of the prestige-documentary interview teaser, in 8-bit: a quiet, awkward sit-down, long pauses, close-ups that are just very big pixels, one line that matters ("you\'re for realsies?"), a hint that the guest might be a bot, then the game. Everything is drawn and synthesised in code with the Realsies art engine (`art/src`): the characters come from the rig (`lookFromSeed` plus a few pinned parts), the interview set is painted in `trailer/src/scenes/interview/set.ts`, the game screens are the engine\'s own scenes, UI kit, countdown art and logo. No footage, images, audio or voices from any film or person are used, and neither character is modelled on a real person.',
  framing: `Framing: the interview is one painted world (320x180 game pixels) shot through 2.4:1 cinema bars at whole-number zooms: the wide at 6 px per game pixel, mediums at 24, the medium close-up at 30, the close-ups at 40. Her close-up then pushes in, in even whole-number zoom steps, to 112 px per game pixel on her eyes (${tc(S.PUSH.t0)} to ${tc(S.PUSH.t1)}) and holds there until the glitch at ${tc(S.GLITCH[0])}. Tight shots defocus the room behind the faces. The montage runs at the game's own 1080p scale (4 px per game pixel) on the Star Station theme.`,
  dialogueNote: `The interview plays out as a chat in the game's own pixel bubbles: his cyan bubbles on his side (left), her grey ones on hers (right), tails turned toward the speaker, at ${S.BUBBLES.k} px per bubble and font pixel (${7 * S.BUBBLES.k}-px capitals). Each line opens with a short typing indicator (bouncing dots), then the text types in; the speaker's mouth opens on its vowels, or follows the recording once there is one. Soft key ticks play under the typing dots; there are no synthesised voices: every line is silent until it is recorded. The bubbles stack from the bottom of the picture and scroll up, three at a time, the oldest dissolving; the chat slides away as the camera pushes in on her eyes. Her mediums are centred and his close-up sits right of centre so the stack clears their faces. The lines are verbatim.`,
  dialogueAfter: `On screen in the montage, in the game's bubbles at the interview's size: "${S.CHAT_LINES.me}" (you) and "${S.CHAT_LINES.them}" (her, gamertag ${TAGS[GUEST_SEAT]}), not voiced.`,
  sound: [
    `0:00 - ${tc(S.GLITCH[0])}: faint room tone (soft brown noise). A low drone (A1 and E2 sines and a buzzy body an octave up) fades in under the wide shot and swells slowly; two beating sines join in the close-ups. Under the push-in a low swell (E1 and B1 sines, a buzz an octave up, a filtered rush) rises through the zoom steps to the held beat on her eyes.`,
    'Dialogue, title card and tagline: no synthesised voices, each line silent until recorded; quiet key ticks under the typing dots, quiet typewriter ticks on the card and the tagline; each recording plays from its line\'s start, panned a little toward the speaker.',
    `${tc(S.GLITCH[0])}: the glitch in her eyes (bitcrushed noise, a diving square chirp, a thump); the drone and the swell cut dead. "Can you tell?" types on over nothing but the room tone.`,
    `${tc(S.beat(-2))}: a two-beat snare pickup; ${tc(S.beat(0))}: an original chiptune at ${S.BPM} BPM in C major (C, G, Am, F; then F, G for the end card): 25% pulse lead, 12.5% pulse arpeggios, a stepped NES-style triangle bass, noise kick, snare and hats.`,
    `Game sounds on the beat: her pedestal lights up, countdown beeps on 3, 2, 1 and CHAT!, the doors whoosh, a message goes out, a message comes in, cursor ticks over YES and NO, a coin as the logo lands (${tc(S.beat(S.CUE.logo))}) while the three rise in with a whoosh, a shing each time the shine sweeps the logo, a ting off the sunglasses, a bwip for the raised eyebrow, a pop for realsies.lol, and a final chime at ${tc(S.beat(S.CUE.chime))} ringing out to the end.`,
    'Mix: synthesised at 48 kHz, peak-limited, then two-pass `loudnorm` (I -14, TP -1.5, linear) so the quiet interview stays quiet against the music.',
  ],
  cast: [
    `Interviewer: seed \`${CAST.host.seed}\`, pinned to glasses, a moustache and a notebook (bald, red sweater). Deadpan.`,
    `Guest: seed \`${CAST.guest.seed}\`, pinned to wavy auburn hair, a neutral mouth that turns into a small smile (teal blazer over a white shirt). In the interview she has large blue eyes with highlights (drawn in \`trailer/src/engine/actor.ts\`); in the game screens she keeps her usual eyes.`,
    `Montage: nine more lobby characters from seeded random looks, and the player "${ME.name}" (seed \`${ME.seed}\`).`,
    `End card: the guest in the middle, flanked by two lobby regulars: ${TAGS[END_SEATS.left]} (in his own sunglasses) and ${TAGS[END_SEATS.right]} (cat ears). The smug pieces (half-lidded eyes, a raised brow, smirks, crossed arms, a finger pushing sunglasses up, a nod, a backlight rim) are composed from the rig's layer sprites in \`trailer/src/engine/expressions.ts\`; the game's own look is unchanged.`,
  ],
};

// ---------------------------------------------------------------- the variant

export const trailer: TrailerDef = {
  name: NAME,
  title: S.TITLE,
  video: 'realsies-trailer.mp4',
  fps: S.FPS,
  duration: S.DURATION,
  shots: S.SHOTS,
  lines: S.LINES,
  dir: DIR,
  drawer,
  poster: (out) => scenes().end.render(out, S.DURATION, true),
  soundtrack,
  // the chat knows when its bubbles scroll off or slide away; the card and tagline last their shot
  onScreen: (line) => (S.CHAT.includes(line) ? scenes().chat.span(line) : undefined),
  script,
};

export default trailer;
