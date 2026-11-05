// What a variant hands the pipeline: its storyboard, a frame drawer bound to its scenes, a poster,
// a soundtrack, and the prose for its script.md.

import type { Rgba } from '../art.ts';
import type { Shot, Line } from './timeline.ts';
import type { Stereo } from './audio/dsp.ts';
import type { VoiceClip, VoiceEnvelopes } from './audio/voice.ts';

export interface ScriptText {
  /** The script.md heading. */
  heading: string;
  /** One paragraph under the format line: what the trailer is. */
  summary: string;
  /** A paragraph after the shot list (framings, zooms). */
  framing: string;
  /** A paragraph before the dialogue table, and one after it. */
  dialogueNote: string;
  dialogueAfter?: string;
  /** Bullets for the Sound and Cast sections. */
  sound: string[];
  cast: string[];
  /** Names for the "Who" column, by speaker. */
  who?: Partial<Record<Line['speaker'], string>>;
  /** What a line without a recording sounds like, for the voice notes (default: silent). */
  unrecorded?: string;
}

export interface TrailerDef {
  /** Variant name (its folder under variants/). */
  name: string;
  /** Title on the contact sheet. */
  title: string;
  /** File name of the video (default `<name>.mp4`). */
  video?: string;
  fps: number;
  /** Seconds; duration * fps should be a whole number of frames. */
  duration: number;
  shots: Shot[];
  /** Every typed line (dialogue, cards, taglines): the ids voice files are matched against. */
  lines: Line[];
  /** The variant's folder (its voice/ lives here). */
  dir: string;
  /** A per-frame drawer bound to the variant's scenes; voice envelopes move the mouths. */
  drawer(voice?: VoiceEnvelopes): (out: Rgba, shot: Shot, t: number) => void;
  /** The poster still. */
  poster(out: Rgba): void;
  /** The soundtrack before loudness normalisation, with these recorded voices mixed in. */
  soundtrack(voices: VoiceClip[]): Stereo;
  /**
   * When a line comes up on screen (its typing dots, or its text) and when it has gone, for
   * script.md. Without an answer: from its start to the end of the shot it starts in.
   */
  onScreen?(line: Line): { from: number; until: number } | undefined;
  script: ScriptText;
}
