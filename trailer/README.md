# Realsies trailers

Trailers for Realsies, rendered entirely in code: pixel art drawn with the game's own engine
(`../art/src`, imported by relative path, no workspaces), every sound synthesised sample by
sample, encoded to H.264 + AAC with ffmpeg. No footage, images, audio or voices from anywhere
else, and no character is modelled on a real person.

## Layout

```
trailer/
  src/
    art.ts            the one door to the pixel engine (../../art/src)
    engine/           generic machinery, no trailer content
      camera.ts         1920x1080 frames, integer-zoom shots of a game-pixel world, bars, fades
      font.ts           5x7 pixel font with lowercase, outlines, extrusion, typewriter counts
      chat.ts           dialogue as chat bubbles in the game's UI kit, typing dots, scrolling stack
      actor.ts          seated, directed rig actors (blinks, glances, mouths, breath, tilt, big eyes)
      expressions.ts    smug pieces: half-lids, raised brow, smirk, crossed arms, sunglasses push, nod
      timeline.ts       shots, framings, push-ins in whole-number zoom steps, typed lines, beat grid
      audio/            dsp.ts (oscillators, filters, mixer, limiter, WAV), instruments.ts (beds,
                        blip voices, chiptune band, UI one-shots), voice.ts (recorded voices)
      frames.ts         frame renderer and the PNG frame folder
      sheet.ts          keyframes.png contact sheet (one frame per shot)
      scriptmd.ts       script.md writer (shot list, dialogue with line ids, voice and rebuild notes)
      encode.ts         loudness normalisation (-14 LUFS, linear), H.264/AAC encode, checks
      pipeline.ts       render a variant end to end
      types.ts          TrailerDef: what a variant exports
    scenes/           reusable building blocks
      interview/        the painted interview set (set.ts) and its directed two-hander (interview.ts)
      cards.ts          black and typed title cards
      montage.ts        the game montage: lobby, 3-2-1 countdown, chat, Real human? call screen
      endcard.ts        the hero end card: shining logo over a smug trio, tagline, URL; the poster
      jackin.ts         the jack-in: a socket in the side of the head, plug and cable, digital rain, a console
      promo/howwin.ts   how you win: you and a labelled partner, calls into a chest, the reveal, the table, WIN
  variants/
    for-realsies/     everything specific to one trailer
      storyboard.ts     shots and timings, dialogue lines with ids, actor direction, music grid, cues, end-card text
      cast.ts           rig seeds and pinned looks, lobby seats and gamertags, the player, the end-card trio
      sound.ts          the song and the cue sheet (what plays when)
      trailer.ts        binds the storyboard to the scenes; script.md prose
      voice/            optional recordings, one per line id
    plug-in/          5 s clip for the AI builders post: a plug seats in her head, three pairs of eyes open
    how-you-win/      29 s scoring video, slow and step by step: two winning calls, a bot and a human
  scripts/            render.ts and new.ts (the npm scripts)
  out/                renders, one folder per variant (gitignored)
```

## Render

Needs Node (built with Node 26) and ffmpeg (with libx264) on PATH.

```
cd trailer
npm install
npm run render                          # for-realsies
npm run render -- <variant>             # any variant
npm run render -- <variant> --dashboard # also copy the outputs to .bl0x/topics/near-hackathon/trailer/
npm run render -- <variant> --keep      # keep the temp folder (PNG frames, mix.wav, audio.wav)
npm run render -- <variant> --no-video  # poster, keyframes and script only (seconds)
```

Writes `out/<variant>/`: `realsies-trailer.mp4`, `poster.png`, `keyframes.png`, `script.md`.
A render takes about half a minute. It is deterministic: the same code gives byte-identical
frames, audio and MP4, so a refactor can be checked against an earlier render with sha256.
`--dashboard` copies only those four files; the topic folder's `.card.json` is never touched.

## Make a variant

1. `npm run new -- <name>` (or `npm run new -- <name> --from <variant>`) copies a variant into
   `variants/<name>/` with an empty `voice/`. A variant is named after its folder, so the copy
   renders straight away.
2. Edit `storyboard.ts`: the shots (each with a `kind` that `trailer.ts` maps to a scene, start
   and end times, framing or push-in, notes for the shot list), the dialogue `LINES` (ids, text,
   start, typing speed), the actors' direction, the music grid and cue beats, the end-card text.
3. Edit `cast.ts` for who is in it (rig seeds plus pinned parts), and `sound.ts` for the song
   and the cue sheet. Keep the order of the calls in `soundtrack()` stable if you want the same
   noise, since every noise-based sound shares one deterministic source.
4. In `trailer.ts`, change the script.md prose, or bind shots to other scenes or new ones from
   `src/scenes/`.
5. `npm run render -- <name>`, then look at `out/<name>/keyframes.png` and the MP4.

## Recording your voice

The dialogue has no synthesised voice: a line is silent until it has a recording (the quiet
key ticks under the typing dots play either way). Each render's `script.md` lists every line id with its start time and how long it is
up on screen.

- Naming: one file per line, named after its line id, in `variants/<name>/voice/`, for example
  `variants/for-realsies/voice/for-realsies.wav`. Files whose names are not line ids are ignored.
- Format: WAV, mono, 48 kHz, 16 or 24 bit is best; mp3, m4a, flac, ogg and aiff work too (ffmpeg
  converts whatever it gets to 48 kHz mono). Peaks around -6 dBFS, no clipping: a take plays at
  its recorded level, then the whole mix is loudness-normalised.
- Timing: a take starts at its line's start time (when its text starts typing), so trim the
  silence before the first word and keep it within the line's time on screen. The text still
  types on, and the speaker's mouth follows the take's loudness.
- Rebuild: `npm run render -- <name> --dashboard` (or without `--dashboard` for `out/` only).

Record your own voice, or performers who have agreed to it; do not imitate a real person. A
variant that wants placeholder voices can mix `standInVoices` (blips, typewriter ticks) from
`src/engine/audio/voice.ts` into its soundtrack.

## Publish

From the repo root, after rendering:

```
deploy/publish-trailer.sh              # for-realsies
deploy/publish-trailer.sh <variant>
```

It uploads `trailer/out/<variant>/realsies-trailer.mp4`, `poster.png` and the page
(`deploy/trailer/index.html`) to https://realsies.lol/trailer. The page links the video and
poster with a content-hash version (`?v=<sha256 prefix>`), so browsers and Cloudflare never
serve a stale render; the page itself is no-cache.
