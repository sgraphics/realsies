# Realsies art pipeline: characters, rooms, animation

Draft 1, 2026-11-04. Covers the per-viewer character system, the five room themes, how both are animated, and how the assets get made in days rather than weeks. Decisions needed are marked **Q** and collected in `../todo/questions.md`.

## 1. Requirements, restated

- Every character a player sees is generated for that player for that round: a name and a look that exist nowhere else. Ten characters per level, three levels, every player, every six hours. So looks must be composed from parts at runtime, not drawn or AI-generated per character.
- One animation logic for all characters: idle bob with knees bending, hands moving slowly, head looking left and right, eyes blinking, an accessory that moves. Skins and decals change, the motion does not.
- The whole world is an 8-bit room: foreground border, deeper background, pedestals in the lobby, speech bubbles in the chat. Five themes that rotate: castle dungeon, jungle, desert Egypt, mountain cave, spaceship. Each room has 3 to 5 looping animated props.
- Looks lively and full, but the play, chat, call loop stays the only thing to do.
- Works on phones and on wide monitors.

## 2. The character rig

One rig, many parts. A character is a stack of transparent PNG layers drawn in a fixed order onto a small canvas, then scaled up with nearest-neighbour. Every part is drawn on the same canvas size so compositing is "draw in order", no anchor maths, and every AI generation request can use the same template.

**Canvas: 32 × 48 game pixels.** Body occupies roughly 24 × 36, feet at the bottom, 8 rows of headroom for hats and hair. Rendered at 3× on phones and 4× to 6× on desktops. NES Mario is 16 × 32; this is one size up so hats, hands and faces stay readable, which the parts need. **Q1:** 32 × 48 as proposed, or chunkier 24 × 32?

Layers, back to front:

| # | Slot | Variants in v1 | Animated by |
|---|---|---|---|
| 0 | shadow | 1 | none |
| 1 | back item | 6 (cape, backpack, tail, wings, jetpack, none) | sway 1 px |
| 2 | legs | 6 bodies × 2 frames (straight, bent) | bob: frame swap |
| 3 | feet | 8 | none |
| 4 | torso | 10 | bob: y offset |
| 5 | arm left | per torso, 2 frames | sway: alternate |
| 6 | arm right | per torso, 2 frames | sway: alternate |
| 7 | head | 6 skins × 3 angles (front, left, right) | look: angle swap |
| 8 | eyes | 8 × 2 frames (open, closed) | blink |
| 9 | mouth | 6 × 2 (closed, open) | talk while a message arrives |
| 10 | hair | 14 × 3 angles | follows head |
| 11 | hat | 12 × 3 angles, plus none | follows head; feather or antenna wiggles |
| 12 | front item | 8 (mug, book, sword, phone, flower, balloon, none) | sway |
| 13 | decal | 10 (badge, stripe, number, logo on the torso) | none |

Three head angles multiply the hair and hat work by three. The cheap alternative is one front-facing head and a 1 px horizontal shift of the eyes to fake a glance; it reads as "looking" at this scale. Start with the cheap version, add angles if time allows.

**Palettes.** Parts are drawn in a reference palette with four ramps: skin, primary cloth, secondary cloth, accent, plus hair. At runtime each character gets ramps picked from a theme palette and the parts are recoloured once into a cache. Mario to Luigi is a palette swap; this is where most of the variety comes from at zero art cost. Master palette: 32 colours, Endesga-32 or a NES-like set, applied to every asset so the world stays coherent.

**Variety.** 6 bodies × 10 torsos × 8 feet × 6 skins × 8 eyes × 14 hair × 13 hats × 7 back × 8 front × 10 decals × palettes gives tens of millions of looks. Two viewers of the same character never see the same one.

**Seeding.** look = f(hash(secret, viewer id, character id, round id)). Same inputs, same look for the whole round, so the character is stable for you and unique to you. Names come from the same seed.

## 3. Animation: procedural, whole pixels, slow

No per-part animation frames beyond the few two-frame swaps above. The rig moves layers by whole game pixels on a slow tick, so the art budget stays flat and every part added is automatically animated.

- Tick: 6 frames per second for the idle, with per-character random phase and speed (seeded) so ten characters never move in lockstep.
- Bob: a 4-tick cycle. Ticks 1 to 2 legs straight, torso, arms, head, hair, hat at y = 0; ticks 3 to 4 legs bent, everything above shifted down 1 px. Knees "bend" because the legs frame swaps as the body drops.
- Breathing: on the torso and arms, an extra 1 px down every other cycle. Subtle, cheap.
- Hands: arms alternate frames every 2 to 3 cycles, 1 px out and back.
- Look: head angle (or eye shift) changes every 2 to 5 seconds, picked at random, holds for 1 to 3 seconds, returns to front. During a chat the character looks toward the chat bubble more often.
- Blink: eyes closed for 1 tick every 3 to 6 seconds, double blink one time in five.
- Accessory: hat feather, antenna, tail or balloon moves 1 px on its own 3-tick cycle.
- Talk: mouth open and closed alternating while the partner's message is arriving; typing indicator in the bubble.
- Reactions: on your call, the character does one of three 6-tick gestures (nod, shrug, wave). Optional.

Implementation: a `Rig` class of about 150 lines in TypeScript drawing to a 2D canvas, parts loaded from one atlas, recoloured copies cached per character. Ten characters × 14 layers × 6 fps is nothing. A CSS version (one absolutely positioned image per layer, `image-rendering: pixelated`, keyframes with `steps()`) also works and needs no per-frame JavaScript, but cannot palette-swap; use it only if canvas is dropped.

## 4. Where the parts come from

Three sources, in the order to try them.

**A. Generate our own part library with image models, into the template.** The product's face is the characters, so they should be ours. The workflow is the one from the pasted X article, adapted from animation strips to part strips:

1. Fix the rig: draw or generate one base body per silhouette at 32 × 48, front view, in the reference palette, and hand-clean it in Aseprite or Pixelorama. This is the anchor every later request gets as a reference.
2. For each slot, request a strip: "edit this 1024 × 1024 canvas into a row of 8 equal 256 × 256 slots, the leftmost is the shipped base character; in slots 2 to 8 draw the same character wearing 7 different hats, same pose, same palette, pixel art, no anti-aliasing, transparent background". Anchoring on the shipped sprite is what keeps proportions and palette.
3. Normalise with a script: find the sprites in the strip, apply one shared scale, snap to the 32 × 48 grid, quantise to the master palette, subtract the base body to isolate the part, save per-slot PNGs, write a review contact sheet.
4. Review, fix outliers by hand, ship.

Model choices, checked 2026-11-04:

| Tool | Transparent output | Pixel grid discipline | Price | Notes |
|---|---|---|---|---|
| OpenAI GPT Image 1.5 | yes, `background: transparent` | good with a reference canvas | per image | What the article used. gpt-image-2 does not support transparency |
| Google Nano Banana 2.1 / Pro (`gemini-nano-banana-2.1`, `gemini-3-pro-image`) | no, output is always opaque | best at following layouts and references, up to 14 reference images, 3 style refs on Pro | per image | Render on a flat magenta background and chroma-key it out; pixel edges are hard so keying is clean. The checkerboard-as-ruler trick from SpriteCook helps it hold the grid |
| Retro Diffusion API | yes, `remove_bg` | native pixel art, `input_palette` forces our palette, `tile_x/y` for seamless tiles | $0.03 to $0.18 per image, tilesets $0.10, idle or subtle-motion animation $0.14 to $0.25 | Best fit for props, tiles and single parts. Reference images up to 9 on the Pro styles |
| PixelLab API | yes, `no_background` | native pixel art, `color_image` forces a palette, skeleton animation, rotations | free trial, subscription | Good for base bodies and rotations |
| SpriteCook | not stated | the 16 × 16 checkerboard reference trick, animation sets | free 40 credits a month, $8 for 800 | Commercial use allowed on all plans, no credit needed. Useful for quick character animation tests |

Recommendation: Retro Diffusion with `input_palette` for parts and props, Nano Banana Pro or GPT Image 1.5 for strips that must follow the anchor exactly, Aseprite for the base bodies and fixes. Budget under $50 of credits for the whole library.

**B. Open-licensed modular sets, as a fallback.** The Universal LPC Spritesheet Character Generator is a paper-doll system with hundreds of bodies, hair, hats and clothes and per-layer export, built for exactly this. Its art is CC-BY-SA 3.0 and GPL 3.0 with per-asset credits (CREDITS.csv), which means attribution and share-alike on the art; the style is 16-bit RPG at 64 × 64, not 8-bit. Use it only if A slips by more than two days.

**C. Hand-drawn.** A pixel artist on a freelance site can draw a 32 × 48 rig with 60 parts in a few days for a few hundred dollars. Worth commissioning after the hackathon to replace the weakest generated parts.

## 5. Names

Generated from the same seed as the look. Tables per theme: first names from a syllable grammar (consonant, vowel, consonant-vowel, two to three syllables), a surname list per theme (castle: Marrow, Ashgrave; jungle: Okoro, Vines; Egypt: Nefer, Sahar; cave: Flint, Graywell; space: Vega, Ortiz-9). **Q2:** whimsical names (Pip Marrow) or plausible ones (Steve Marrow)? Plausible makes the human question harder and the room feel like a chat, whimsical reads as a game. Proposal: plausible first names, themed surnames.

## 6. Rooms: the five themes

Each theme is one asset kit with the same five pieces, so the room code is written once:

| Piece | What | Size |
|---|---|---|
| Backdrop | deep-colour background, two parallax layers that tile horizontally | 480 × 270 per layer, tileable on x |
| Frame | foreground border as a 9-slice: 4 corners, 4 repeating edges | 32 px thick |
| Pedestal | 3 states: empty, occupied, selected (glow) | 48 × 24 |
| Props | 3 to 5 animated loops, 4 to 8 frames each | 16 to 48 px |
| Bubble and sign | speech bubble 9-slice, name plate, level banner | 16 px slices |

Themes and their props:

| Theme | Backdrop | Animated props |
|---|---|---|
| Castle dungeon | stone arches, deep blue-black | torch flames, dripping water, a bat crossing, chains swaying |
| Jungle | layered leaves, deep green | waterfall, fireflies, vine sway, a parrot blinking |
| Desert Egypt | sandstone pillars, hieroglyph band, dusk orange | sand drift, brazier flame, scarab walk, a sun disc pulsing |
| Mountain cave | crystals, dark purple | crystal pulse, stalactite drip, lava bubble, a bat |
| Spaceship | bulkheads and windows, deep navy | console blink, stars scrolling past, airlock steam, a hovering drone |

Sources per theme, licences checked 2026-11-04:

- Castle: ansimuz "Gothicvania Cold Corridors", free, tileset, looping parallax layers and an animated torch; its page states no licence text, so confirm with the author or treat as attribution-required. Kenney "Tiny Dungeon", CC0, 16 × 16.
- Jungle: ansimuz "Sunny Land", CC0, with forest tiles, props and backgrounds.
- Cave: ansimuz "Super Grotto Escape", free, sci-fi cave tiles and parallax.
- Space: ansimuz "Warped Sci-Fi Lab" and "Warped Zone 202", free, parallax lab backgrounds.
- Desert: nothing free found. Generate with Retro Diffusion tilesets and a Nano Banana Pro mural keyed to the palette.
- Characters and props in a matching style: 0x72 "DungeonTileset II", CC0, 16 × 16 with animated torches and chests.

Where a pack has no written licence, ask or replace; everything shipped gets a line in CREDITS.md. Generated pieces: the same four-step workflow as the characters, with `tile_x` for the backdrop layers, and prop animations from Retro Diffusion's idle and subtle-motion styles or drawn as 4-frame loops by hand.

## 7. Layout on any screen

- Logical resolution in game pixels, scaled by the largest integer that fits the window and centred, with the theme's frame extended to the edges so letterboxing is part of the room. Landscape 320 × 180 logical at 3× to 8×; portrait 180 × 320 at 2× to 4× on phones.
- Lobby: pedestals in a 5 × 2 grid in landscape, 2 × 5 in portrait, under the level banner, the room title and a pillar with your coins, rating and the round clock, as in the mockup.
- Chat: your partner stands on a pedestal at the left (top on phones), bubbles alternate sides on the right, the input is a native DOM field over the canvas so phone keyboards behave. Two-minute clock as a burning fuse or torch along the frame.
- Call screen: the partner alone, two big buttons, Real human: Yes / No. Then "locked until the round ends" with the clock.
- Font: a 5 × 7 bitmap font or "Press Start 2P", with a readable fallback for chat text at small sizes.
- Reduced motion: honour the OS setting by freezing props and keeping only blinks.

## 8. The generation workflow, as a plan

1. Master palette and the 32 × 48 template with slot boxes; one base body cleaned by hand.
2. Strips per slot via the chosen model, 8 variants per request; normalise script; contact sheet; fix.
3. Rig demo page: ten random characters bobbing, blinking and looking, on a flat background. This is the first thing to show.
4. Theme kits: start with castle (most free material), then space, jungle, cave, desert.
5. Props and bubbles, then the lobby and chat screens on real assets.
6. Polish pass: shadows, selection glow, reactions.

Tooling: Python with Pillow for the normalise and recolour scripts; Aseprite (paid) or Pixelorama (free) for fixes; TexturePacker or a 30-line script for the atlas.

## 9. Quality checklist

- One light direction across all parts and props.
- One-pixel outlines, darker shade of the fill, never black on everything.
- Master palette only; the normalise script rejects any other colour.
- No anti-aliasing, no sub-pixel moves, scaling only by integers.
- Parts stay inside their slot boxes and never overdraw the face.
- Contrast between character and pedestal, and between bubble text and bubble, checked on a phone outdoors.
