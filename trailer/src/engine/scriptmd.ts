// script.md for a variant, written from its storyboard so the paperwork always matches the cut:
// the variant's prose around generated tables (shots, dialogue with line ids and timings) and the
// generic voice drop-in and rebuild sections.

import { lineShown, lineTimes } from './timeline.ts';
import type { TrailerDef } from './types.ts';

/** 0:07.5 style timecode. */
export function tc(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

const WHO = { host: 'Interviewer', guest: 'Guest', card: 'Title card', tagline: 'End card' };

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
  L.push('| Line id | Who | Typing dots | Types in | Line |');
  L.push('|---------|-----|-------------|----------|------|');
  for (const l of def.lines) {
    const end = lineTimes(l).end;
    const dots = l.lead ? tc(l.at - l.lead) : '-';
    L.push(`| \`${l.id}\` | ${who[l.speaker]} | ${dots} | ${tc(l.at)} to ${tc(end)} | ${lineShown(l)} |`);
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
  L.push('## Dropping in recorded voices');
  L.push('');
  L.push(`Put a recording named after a line id in \`${vdir}\`, for example \`${vdir}${def.lines[0]?.id ?? 'line-id'}.wav\` (any format ffmpeg reads: wav, mp3, m4a, flac, ogg), and render again. That line's blips (or typewriter ticks) are replaced by the recording, starting when its text starts typing; the text still types on, and the speaker's mouth follows the loudness of the recording. Lines without a file keep their blips. Line ids: ` + def.lines.map((l) => '`' + l.id + '`').join(', ') + '. Keep each take about as long as its typing. Record your own voices or performers who have agreed to it; do not imitate a real person.');
  L.push('');
  L.push(o.voices.length ? `This render used recorded voices for: ${o.voices.map((v) => '`' + v + '`').join(', ')}.` : 'This render uses the synthesised blip voices only (no voice files present).');
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
