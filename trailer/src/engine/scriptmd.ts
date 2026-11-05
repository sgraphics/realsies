// script.md for a variant, written from its storyboard so the paperwork always matches the cut:
// the variant's prose around generated tables (shots, dialogue with line ids and timings) and the
// generic recording and rebuild sections.

import { lineShown, lineTimes, shotAt, type Line } from './timeline.ts';
import type { TrailerDef } from './types.ts';

/** 0:07.5 style timecode. */
export function tc(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** 0:07.45 style timecode, for the dialogue table (recordings are placed to the sample). */
function tc2(t: number): string {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
}

const WHO = { host: 'Interviewer', guest: 'Guest', card: 'Title card', tagline: 'End card' };

/** When a line is on screen: the variant's answer, or from its start to the end of its shot. */
function onScreen(def: TrailerDef, l: Line): { from: number; until: number } {
  return def.onScreen?.(l) ?? { from: l.at, until: shotAt(def.shots, l.at).end };
}

export function scriptMarkdown(def: TrailerDef, o: { voices: string[]; video: string; sizeMb?: number }): string {
  const s = def.script;
  const who = { ...WHO, ...(s.who ?? {}) };
  const L: string[] = [];
  L.push(`# ${s.heading}`);
  L.push('');
  L.push(`${def.duration.toFixed(1)} s, 1920x1080, ${def.fps} fps, H.264 + AAC, loudness-normalised to -14 LUFS.` + (o.sizeMb ? ` File: ${o.video} (${o.sizeMb.toFixed(1)} MB).` : ''));
  L.push('');
  L.push(s.summary);
  L.push('');
  L.push('## Shot list');
  L.push('');
  L.push('| # | Time | Shot | What happens |');
  L.push('|---|------|------|--------------|');
  def.shots.forEach((sh, i) => L.push(`| ${i + 1} | ${tc(sh.start)} - ${tc(sh.end)} | ${sh.title} | ${sh.notes} |`));
  L.push('');
  L.push(s.framing);
  L.push('');
  L.push('## Dialogue');
  L.push('');
  L.push(s.dialogueNote);
  L.push('');
  L.push('Every line has an id: the name its recording goes under (see Recording your voice). **Starts** is when its text starts typing and when its recording starts playing; **Dots** is when its typing indicator comes up, if it has one; **Typed by** is when the last letter is in; **Gone at** is when the line has left the screen (scrolled off the chat, the chat slid away, the card cut), and **Up for** is how long it is up from its start, the room a take has.');
  L.push('');
  L.push('| Line id | Who | Line | Dots | Starts | Typed by | Gone at | Up for |');
  L.push('|---------|-----|------|------|--------|----------|---------|--------|');
  for (const l of def.lines) {
    const span = onScreen(def, l);
    const dots = span.from < l.at ? tc2(span.from) : '-';
    L.push(`| \`${l.id}\` | ${who[l.speaker]} | ${lineShown(l)} | ${dots} | ${tc2(l.at)} | ${tc2(lineTimes(l).end)} | ${tc2(span.until)} | ${(span.until - l.at).toFixed(1)} s |`);
  }
  L.push('');
  if (s.dialogueAfter) {
    L.push(s.dialogueAfter);
    L.push('');
  }
  L.push('## Sound');
  L.push('');
  for (const b of s.sound) L.push('- ' + b);
  L.push('');
  L.push('## Cast (art engine rig)');
  L.push('');
  for (const b of s.cast) L.push('- ' + b);
  L.push('');
  const vdir = `trailer/variants/${def.name}/voice/`;
  L.push('## Recording your voice');
  L.push('');
  L.push(`${s.unrecorded ?? 'A line without a recording is silent; its text still types on.'} To give a line a voice, record it and put the file in \`${vdir}\`:`);
  L.push('');
  L.push(`- **Naming**: one file per line, named after its line id from the table above: \`${vdir}${def.lines[0]?.id ?? 'line-id'}.wav\` and so on for ` + def.lines.map((l) => '`' + l.id + '`').join(', ') + '. A file whose name is not a line id is ignored.');
  L.push('- **Format**: WAV, mono, 48 kHz, 16 or 24 bit is best; mp3, m4a, flac, ogg and aiff work too (whatever it is, ffmpeg converts it to 48 kHz mono). Record at a steady level, peaks around -6 dBFS and no clipping: a take plays at the level it was recorded, then the whole mix is loudness-normalised.');
  L.push("- **Timing**: a take starts playing at its line's **Starts** time, so trim the silence before the first word, and keep it within the line's **Up for** (anything past the end of the video is cut). The text still types on at its own pace, and the speaker's mouth follows the loudness of the take.");
  L.push(`- **Rebuild**: \`cd trailer && npm run render -- ${def.name} --dashboard\` (without \`--dashboard\` it only writes \`trailer/out/${def.name}/\`). The new script.md says which lines it found recordings for.`);
  L.push('- Record your own voice, or performers who have agreed to it; do not imitate a real person.');
  L.push('');
  L.push(o.voices.length ? `This render used recordings for: ${o.voices.map((v) => '`' + v + '`').join(', ')}.` : 'This render has no recordings yet.');
  L.push('');
  L.push('## Rebuild');
  L.push('');
  L.push('```');
  L.push('cd trailer');
  L.push(`npm run render -- ${def.name}               # video, poster, keyframes and this script into trailer/out/${def.name}/`);
  L.push(`npm run render -- ${def.name} --dashboard   # also copy them to the dashboard topic folder`);
  L.push(`npm run render -- ${def.name} --keep        # keep the temp folder (frames, mix.wav) for inspection`);
  L.push('```');
  L.push('');
  L.push(`Source: \`trailer/variants/${def.name}/\` holds everything specific to this trailer (storyboard and timings, cast, dialogue with line ids, music and sound cues, end-card text, voice/); the scenes it is built from are in \`trailer/src/scenes/\` (interview set, cards, game montage, hero end card) and the generic machinery in \`trailer/src/engine/\` (camera, font, chat bubbles, actors and expressions, audio synthesis, frames, contact sheet, this writer, encode). The pixel engine is \`art/src\`. Frames are rendered to a temp folder, encoded with libx264 (CRF 18, yuv420p, BT.709) and AAC, and the temp folder is deleted.`);
  L.push('');
  return L.join('\n');
}
