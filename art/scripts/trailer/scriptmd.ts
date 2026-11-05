// script.md, written from the storyboard so the paperwork always matches the cut.

import { BPM, CUE, DURATION, FPS, LINES, SHOTS, TAGS, GUEST_SEAT, CHAT_LINES, GLITCH, END_SEATS, PUSH, beat, lineShown, lineTimes } from './storyboard.ts';
import { CAST } from './actor.ts';

/** 0:07.5 style timecode. */
export function tc(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

const who = (s: string) => (s === 'host' ? 'Interviewer' : s === 'guest' ? 'Guest' : s === 'card' ? 'Title card' : 'End card');

export function scriptMarkdown(o: { voices: string[]; sizeMb?: number }): string {
  const L: string[] = [];
  L.push('# Realsies launch trailer: "For realsies?"');
  L.push('');
  L.push(`${DURATION.toFixed(1)} s, 1920x1080, ${FPS} fps, H.264 + AAC, loudness-normalised to -14 LUFS.` + (o.sizeMb ? ` File: realsies-trailer.mp4 (${o.sizeMb.toFixed(1)} MB).` : ''));
  L.push('');
  L.push('A deadpan parody of the prestige-documentary interview teaser, in 8-bit: a quiet, awkward sit-down, long pauses, close-ups that are just very big pixels, one line that matters ("For realsies?"), a hint that the guest might be a bot, then the game. Everything is drawn and synthesised in code with the Realsies art engine (`art/`): the characters come from the rig (`lookFromSeed` plus a few pinned parts), the interview set is painted in `scripts/trailer/set.ts`, the game screens are the engine\'s own scenes, UI kit, countdown art and logo. No footage, images, audio or voices from any film or person are used, and neither character is modelled on a real person.');
  L.push('');
  L.push('## Shot list');
  L.push('');
  L.push('| # | Time | Shot | What happens |');
  L.push('|---|------|------|--------------|');
  SHOTS.forEach((s, i) => L.push(`| ${i + 1} | ${tc(s.start)} - ${tc(s.end)} | ${s.title} | ${s.notes} |`));
  L.push('');
  L.push(`Framing: the interview is one painted world (320x180 game pixels) shot through 2.4:1 cinema bars at whole-number zooms: the wide at 6 px per game pixel, mediums at 24, the medium close-up at 30, the close-ups at 40. Her close-up then pushes in, in even whole-number zoom steps, to 112 px per game pixel on her eyes (${tc(PUSH.t0)} to ${tc(PUSH.t1)}) and holds there until the glitch at ${tc(GLITCH[0])}. Tight shots defocus the room behind the faces. The montage runs at the game's own 1080p scale (4 px per game pixel) on the Star Station theme.`);
  L.push('');
  L.push('## Dialogue');
  L.push('');
  L.push("The interview plays out as a chat in the game's own pixel bubbles: his cyan bubbles on his side (left), her grey ones on hers (right), tails turned toward the speaker. Each line opens with a short typing indicator (bouncing dots and soft key ticks), then the text types in with the speaker's blip voice (interviewer low and square, guest higher and thinner) in 35-px capitals. The bubbles stack from the bottom of the picture and scroll up, three at a time, the oldest dissolving; the chat slides away as the camera pushes in on her eyes. The lines are verbatim.");
  L.push('');
  L.push('| Line id | Who | Typing dots | Types in | Line |');
  L.push('|---------|-----|-------------|----------|------|');
  for (const l of LINES) {
    const end = lineTimes(l).end;
    const dots = l.lead ? tc(l.at - l.lead) : '-';
    L.push(`| \`${l.id}\` | ${who(l.speaker)} | ${dots} | ${tc(l.at)} to ${tc(end)} | ${lineShown(l)} |`);
  }
  L.push('');
  L.push(`On screen in the montage (chat bubbles, not voiced): "${CHAT_LINES.me}" (you) and "${CHAT_LINES.them}" (her, gamertag ${TAGS[GUEST_SEAT]}).`);
  L.push('');
  L.push('## Sound');
  L.push('');
  L.push(`- 0:00 - ${tc(GLITCH[0])}: faint room tone (soft brown noise). A low drone (A1 and E2 sines and a buzzy body an octave up) fades in under the wide shot and swells slowly; two beating sines join in the close-ups. Under the push-in a low swell (E1 and B1 sines, a buzz an octave up, a filtered rush) rises through the zoom steps to the held beat on her eyes.`);
  L.push(`- Dialogue: soft key ticks under each typing indicator, then one blip per letter as the bubble types, pitched per speaker, with a rise at the end of questions; vowels open the mouth on screen.`);
  L.push(`- ${tc(GLITCH[0])}: the glitch in her eyes (bitcrushed noise, a diving square chirp, a thump); the drone and the swell cut dead. "Can you tell?" types on in near silence with typewriter ticks.`);
  L.push(`- ${tc(beat(-2))}: a two-beat snare pickup; ${tc(beat(0))}: an original chiptune at ${BPM} BPM in C major (C, G, Am, F; then F, G for the end card): 25% pulse lead, 12.5% pulse arpeggios, a stepped NES-style triangle bass, noise kick, snare and hats.`);
  L.push(`- Game sounds on the beat: her pedestal lights up, countdown beeps on 3, 2, 1 and CHAT!, the doors whoosh, a message goes out, typing ticks, a message comes in, cursor ticks over YES and NO, a coin as the logo lands (${tc(beat(CUE.logo))}) while the three rise in with a whoosh, a shing each time the shine sweeps the logo, a ting off the sunglasses, a bwip for the raised eyebrow, a pop for realsies.lol, and a final chime at ${tc(beat(CUE.chime))} ringing out to the end.`);
  L.push('- Mix: synthesised at 48 kHz, peak-limited, then two-pass `loudnorm` (I -14, TP -1.5, linear) so the quiet interview stays quiet against the music.');
  L.push('');
  L.push('## Cast (art engine rig)');
  L.push('');
  L.push(`- Interviewer: seed \`${CAST.host.seed}\`, pinned to glasses, a moustache and a notebook (bald, red sweater). Deadpan.`);
  L.push(`- Guest: seed \`${CAST.guest.seed}\`, pinned to wavy auburn hair, a neutral mouth that turns into a small smile (teal blazer over a white shirt). In the interview she has large blue eyes with highlights (drawn in \`scripts/trailer/actor.ts\`); in the game screens she keeps her usual eyes.`);
  L.push('- Montage: nine more lobby characters from seeded random looks, and the player "Ana" (seed `me-120`).');
  L.push(`- End card: the guest in the middle, flanked by two lobby regulars: ${TAGS[END_SEATS.left]} (in his own sunglasses) and ${TAGS[END_SEATS.right]} (cat ears). The smug pieces (half-lidded eyes, a raised brow, smirks, crossed arms, a finger pushing sunglasses up, a nod, a backlight rim) are composed from the rig's layer sprites in \`scripts/trailer/smug.ts\`; the game's own look is unchanged.`);
  L.push('');
  L.push('## Dropping in recorded voices');
  L.push('');
  L.push('Put a recording named after a line id in `art/scripts/trailer/voice/`, for example `art/scripts/trailer/voice/for-realsies.wav` (any format ffmpeg reads: wav, mp3, m4a, flac, ogg), and run `npm run trailer` again in `art/`. That line\'s blips are replaced by the recording, starting when its bubble starts typing; the bubble still types on, and the speaker\'s mouth follows the loudness of the recording. Lines without a file keep their blips. Line ids: ' + LINES.map((l) => '`' + l.id + '`').join(', ') + '. Keep each take about as long as its typing (the bubble stays up as the chat scrolls on). Record your own voices or performers who have agreed to it; do not imitate a real person.');
  L.push('');
  L.push(o.voices.length ? `This render used recorded voices for: ${o.voices.map((v) => '`' + v + '`').join(', ')}.` : 'This render uses the synthesised blip voices only (no voice files present).');
  L.push('');
  L.push('## Rebuild');
  L.push('');
  L.push('```');
  L.push('cd art');
  L.push('npm run trailer            # frames, audio, MP4, poster, keyframes, this script');
  L.push('npm run trailer -- --keep  # keep the temp folder (frames, mix.wav) for inspection');
  L.push('```');
  L.push('');
  L.push('Source: `art/scripts/trailer/` (`storyboard.ts` is the whole edit as data; `set.ts` the interview set; `actor.ts` the seated, directed rig; `smug.ts` the smug poses on the end card; `chat.ts` the interview bubbles; `interview.ts`, `montage.ts`, `endcard.ts` and `render.ts` the frames; `audio.ts` the soundtrack; `build.ts` the pipeline). Frames are rendered to a temp folder, encoded with libx264 (CRF 18, yuv420p, BT.709) and AAC, and the temp folder is deleted.');
  L.push('');
  return L.join('\n');
}
