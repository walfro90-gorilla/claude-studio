# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Remotion 4.0.498 project (React + TypeScript video rendering), scaffolded from the `blank` template with Tailwind v4. React 19. Videos are React components; frames are rendered in headless Chrome and encoded by Remotion's bundled ffmpeg.

## Commands

```
npm run dev            # remotion studio — live preview at localhost:3000, the main dev loop
npm run lint           # eslint src scripts && tsc — lint + typecheck in one
npm run check          # self-checks for the caption mapping and the silence cut
npm run compositions   # list registered composition IDs
npm run short          # media file in, subtitled short out — the whole pipeline
npm run transcribe     # audio -> public/captions.json (loads .env automatically)
npm run build          # remotion bundle — builds the bundle only, does NOT render a video
npm run upgrade        # remotion upgrade — bumps all Remotion packages together
```

Rendering passes through to the CLI, so flags go after `--`:

```
npm run render -- Captions out/video.mp4
npm run render -- Captions out/test.mp4 --frames=0-29   # fast smoke test, ~10s
npm run still  -- Captions out/frame.png --frame=110
```

No test framework is installed, by design. `npm run check` covers the pure logic — the caption mapping and the silence cut — and a short `--frames=0-29` render covers the video path, the cheapest proof that bundle, headless Chrome, and encoder all still work. Run the render check after touching composition code, `remotion.config.ts`, or webpack config.

Layout and timing bugs survive both. When a composition changes, render one still where content should be visible and look at it; `ffmpeg -i frame.png -vf scale=1:1 -f rawvideo -pix_fmt rgb24 - | xxd -p` prints the average pixel, which is enough to tell "something is drawn" from "black".

## Layout

```
src/                    # video code only — bundled into the render
  index.ts              # registerRoot, the single Remotion entry point
  Root.tsx              # registers every composition; a video not listed here does not exist
  index.css             # Tailwind entry
  compositions/         # one file per video = one <Composition> declaration
  components/           # reusable pieces shared across compositions
  lib/                  # pure logic — the cut and the framing; scripts/ imports it too
scripts/                # console tools, run directly by Node — never bundled
  lib/                  # domain logic: no argv, no console, no process.exit
  transcribe.mts        # thin CLI shell over lib/
public/                 # runtime assets: audio, captions.json — served at the root
out/                    # renders, gitignored
.claude/skills/         # repeatable workflows Claude Code runs on request
```

Tracked vs ignored: `.claude/skills/` is committed (shared workflows) while `.claude/settings.local.json` is not (per-machine permissions). `public/` fixtures are committed; `out/`, `node_modules/`, and `.env` are not.

Setting this up somewhere else is `INSTALL.md` — prerequisites (Node 22.18+, since the npm scripts pass no `--experimental-strip-types` and rely on stripping being on by default), and five verification gates ordered cheapest first. `MASTER-PROMPT.xml` is the same procedure addressed to Claude Code, to paste into a fresh session on the new machine. The repo is public at `github.com/walfro90-gorilla/claude-studio`, so treat anything committed as published — the gitignored files (`.env`, `corrections.json`, `overlays.json`, your own media in `public/`) are the line.

Two boundaries carry the design:

**`src` vs `scripts`** — `src` runs inside headless Chrome under Remotion's bundler; `scripts` runs in plain Node with filesystem and network access. Transcription, file IO, and API calls belong in `scripts` and hand results to `src` through `public/`. Do not import across that line, with one deliberate exception: `scripts` imports `src/lib/*`, which is pure and DOM-free, so the CLI and the composition cannot disagree about the cut or the framing. Nothing else in `src` may be imported from `scripts`.

**`scripts/lib` vs `scripts/*.mts`** — `lib/` holds pure domain functions that take arguments and return values. The `.mts` files at the top of `scripts/` are shells: parse argv, read env, write files, print. This split exists so the same functions can back an HTTP handler later without being untangled from CLI plumbing. Keep new logic in `lib/`; a shell should stay short enough to read at a glance.

## Architecture

Entry chain — adding a video means touching the last two:

- `src/index.ts` — calls `registerRoot(RemotionRoot)`. Nothing else should live here.
- `src/Root.tsx` — imports `./index.css` and renders each composition component.
- `src/compositions/Captions.tsx` — exports `Captions`, returning a `<Composition>` (id `Captions`, 1080x1920, 30fps) pointing at `CaptionedVideo`.
- `src/components/CaptionedVideo.tsx` — the actual video component.

`<Composition>` is a *declaration*, not a render: it registers an id plus dimensions/duration with Remotion. The CLI and Studio look compositions up by that id, so `id` is the public handle — renaming it breaks render commands and any CI referencing it. Register more videos by adding a file under `compositions/` and rendering it in `Root.tsx`.

`calculateMetadata` runs before render and can override duration, dimensions, and props dynamically. `Captions.tsx` uses it to `fetch(staticFile('captions.json'))`, run the cut, and set `durationInFrames` to the cut length — so a new transcript resizes the video with no code change. The `durationInFrames={1}` on the element is a placeholder that `calculateMetadata` always replaces.

The caption font is pinned: `CaptionedVideo.tsx` calls `loadFont` from `@remotion/google-fonts/Montserrat` at module scope and passes the returned `fontFamily` into the style. Without this the render inherits whatever font the rendering machine happens to have — DejaVu on this Linux box, something else on Lambda. Remotion blocks the render until the face is ready, so the first frames never draw in a fallback. Swap fonts by changing that one import and weight; both must exist in the Google Fonts catalog.

Inside a component, `useCurrentFrame()` drives all animation. Remotion renders each frame as a fresh, deterministic snapshot — the same frame number must always produce the same pixels, so no `Date.now()`, no `Math.random()`, no un-seeded state, and no animation driven by wall-clock time or CSS transitions.

`public/` is served at the root and is the only correct place for assets loaded at runtime; reference them with `staticFile('name.png')`, not a relative path.

## The one-command path

```
npm run short -- <file> [more files...] [--out=x.mp4] [--from=12] [--to=1:30] [--music=song.mp3] [--hook="MIRA ESTO"] [--handle=@you]
                   [--crop=left] [--zoom] [--fit] [--lang=es] [--caption=lower] [--color=#00e5ff]
node scripts/short.mts --check                  # routing self-check, no API call, no render
```

**Every positional argument is an input**, played in the order given; the destination is named with `--out=` and defaults to `out/short.mp4`. Guessing which trailing path was meant as the output is exactly the magic that transcribes the file you meant to write.

No conversion step is needed for the usual containers. `.mkv` in particular goes straight through — AssemblyAI accepts the upload and Remotion's ffmpeg demuxes matroska — verified end to end on H.264 + AAC, which is what OBS and most screen recorders produce. What matters is the codec inside, not the extension; a container Chrome cannot decode would fail at render time, not at transcription.

`scripts/short.mts` copies each input into `public/` if it is not already there (compositions can only read from `public/`), transcribes them one at a time, writes `public/captions.json`, and shells out to `remotion render`. Routing lives in `scripts/lib/short.mts`: a video extension plays behind the captions with its own audio, anything else plays over black.

It renders by spawning the Remotion CLI rather than calling `@remotion/renderer` directly — deliberately. The Node API ignores `remotion.config.ts`, so the Tailwind webpack override would have to be re-passed by hand and silently breaks styling if forgotten.

Reach for the individual commands below when tuning; `short` is for when the settings are already right.

## Heavy source footage

`short` hands each input to two jobs that both scale with its size: it uploads the file to AssemblyAI **whole, video track included**, then renders from that same file. Screen recordings are fine. Camera footage usually is not — a phone or drone clip is commonly 3K or 4K, 10-bit HEVC, 48–60fps, and hundreds of megabytes per minute, which buys a slow upload and a much slower render for pixels the composition throws away.

Build 1080x1920 proxies first. The composition renders at 1080x1920 regardless, so the downscale costs nothing that would have survived:

```
ffmpeg -y -i source.MP4 -map 0:v:0 -map 0:a:0 \
  -vf scale=1080:1920 -r 30 \
  -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k public/clip-01.mp4
```

On an Intel iGPU, VAAPI does it in a fraction of the time — 135s of 3K HEVC in about a minute, where the libx264 line above at `-preset medium` had not finished a single 17s clip in eight:

```
ffmpeg -y -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 -hwaccel_output_format vaapi \
  -i source.MP4 -map 0:v:0 -map 0:a:0 \
  -vf 'scale_vaapi=w=1080:h=1920:format=nv12,fps=30' \
  -c:v h264_vaapi -qp 23 -c:a aac -b:a 192k public/clip-01.mp4
```

Check with `ls /dev/dri/` and `ffmpeg -encoders | grep vaapi`. Two arguments are load-bearing and both fail loudly only in specific cases:

- `format=nv12` — a 10-bit source without it dies with `No usable encoding profile found`, because `h264_vaapi` cannot take the 10-bit surface the decoder handed it. 8-bit sources work either way, so this bites only on modern camera footage.
- `-map 0:v:0` — camera files often carry a second, MJPEG *thumbnail* video stream. Without the map ffmpeg tries to transcode it too.

An `hevc_nvenc` entry in `ffmpeg -encoders` means only that ffmpeg was built with it; confirm the GPU exists with `lspci | grep -i vga` first.

Measured on nine DJI clips: 1.4GB of 1728x3072 HEVC became 143MB, and 135s of source rendered to an 86s short in about 12 minutes.

## Captions (AssemblyAI → Remotion)

AssemblyAI complements Remotion rather than overlapping it: it turns audio into word-level timestamps, Remotion turns those into animated captions. `scripts/transcribe.mts` is the bridge.

```
npm run transcribe -- <audio-path-or-url> [out.json] [--lang=es]   # key read from .env
node scripts/transcribe.mts --check                    # mapping self-check, no API call, no key
```

`ASSEMBLYAI_API_KEY` lives in `.env` (gitignored; `.env.example` is the template). Node loads it via `--env-file-if-exists` in the npm script. Output defaults to `public/captions.json`, written as `{clips: [...]}` — the same shape `npm run short` produces, with one entry. Node runs the `.mts` directly via native type stripping — no build step, no ts-node.

### Language

Detection runs by default and **the chosen language is printed on every run** (`49 words, detected es (99% sure)`), because a wrong language is otherwise only discovered by watching the finished video. Below 70% confidence it also says so. Pin it with `--lang=es` when the answer is known — `transcribeToCaptions` then sends `language_code` instead of `language_detection`.

The flag is validated by *shape* (`es`, `en_us`), not against AssemblyAI's hundred-entry list, which would go stale. That catches a typo before it costs an API call and lets any real code through.

Verified end to end on Spanish: detection picked `es` at 99%, the transcript carried its accents, and Montserrat renders the full repertoire — `¿ ¡ Ñ Á É Í Ó Ú Ü` — under `subsets: ["latin"]`. A missing glyph would render as a blank box, and only a still shows it.

### Fixing misheard words

The transcriber reliably mishears brand and product names — "cloud" for Claude, and worse in a second language. `corrections.json` at the repo root (gitignored; `corrections.example.json` is the template) is a `{"misheard": "correct"}` map applied after every transcription by both `short` and `transcribe`, so a fix survives re-running. `applyCorrections` in `scripts/lib/captions.mts` matches whole words case-insensitively, keeps trailing punctuation, and preserves the ALL-CAPS shape the captions render in. Reading the file is `scripts/lib/corrections.mts`, kept apart so `captions.mts` stays fs-free.

Single-word only, on purpose: a one-to-many fix (`"mister all"` → Mistral) spans two timestamped words and is deferred until it bites, since it needs a matcher over the token stream rather than a bigger map.

**Read the transcript before the render, not after.** `public/captions.json` is written before `short` shells out to `remotion render`, so a wrong brand name caught at that moment costs nothing: fix the JSON, add the pair to `corrections.json` so it never returns, and re-render with `npm run render -- Captions out/x.mp4`. The composition takes its sources from the transcript, so that command needs no props and no second transcription — and no second API charge. Catching it after a twelve-minute render costs the render.

### The mapping

The one non-obvious detail, and the reason the mapping isn't a plain field rename: `createTikTokStyleCaptions` from `@remotion/captions` splits pages on a **leading space** in `Caption.text` and otherwise concatenates tokens verbatim. AssemblyAI's words carry no leading space, so a naive mapping glues the whole transcript into a single unbreakable word. `wordsToCaptions` prepends a space to every word except the first; `--check` asserts exactly that and fails if it regresses.

`COMBINE_TOKENS_WITHIN_MS` in `CaptionedVideo.tsx` behaves as a *minimum page duration*, not a gap threshold — a page only breaks once it already spans that long. Lower it for faster cuts. It ignores silence, so a long pause mid-page does not force a break.

`public/sample.mp3` is a 20-second English news clip kept as a fixture, and `public/captions.json` holds its real transcript, so the composition renders out of the box. `npm run transcribe` overwrites the JSON — copy it aside first if it still matters.

## Trimming the ends

`--from` and `--to` set manual in/out points, in seconds or `mm:ss` / `hh:mm:ss`:

```
npm run short -- clip.mp4 out.mp4 --from=12 --to=1:30
npm run render -- Captions out/v.mp4 --props='{"clipStartMs":12000,"clipEndMs":90000}'
```

The window is applied *before* the silence cut, so both compose: the window picks the take, the silence cut tightens what is inside it.

Only words spoken **whole** inside the window survive. A word straddling an edge is dropped rather than clipped — keeping one cuts its audio mid-syllable, and at the in-point its caption shifts to a negative time and is never drawn (that bug shipped once; the `--check` now asserts against it). Expect the output to start on the first complete word after `--from`, not exactly at it.

## Cutting the silence

`src/lib/silence.ts` turns the word timestamps into the stretches worth keeping and drops the dead air between them. Nothing analyses the audio — AssemblyAI already says where the words are, so the gaps between them *are* the silence.

Two constants in `Captions.tsx` drive it. `TRIM_SILENCE_OVER_MS` (700) is the longest pause kept; set it to `null` to leave the media whole. `PAD_MS` (150) is the breathing room kept on each side of a cut so consonants are not clipped, and it never eats more than half a gap, so neighbouring segments cannot pad into each other and replay the same moment twice.

`calculateMetadata` runs the trim, so `durationInFrames` is the *cut* length and the captions handed to the component are already shifted onto the shortened timeline. The component then renders one `<Series.Sequence>` per surviving stretch, each holding the media with `trimBefore`/`trimAfter` pointing into the source.

The one subtlety worth preserving: captions are shifted by the accumulated **frame** offset, not the millisecond one. Each segment rounds to whole frames independently, so shifting in milliseconds drifts the captions a little further out of sync with every cut.

Measured on 14.08s of speech with a 4s silence spliced into the middle: output 10.39s, and `silencedetect` finds no pause over 1s where the input had one of 4.07s.

`npm run check` covers this: gap detection, frame counts, the shifted timing, empty input, and `maxGapMs: null` leaving the media untouched.

## Chaining clips

Several inputs become one short. Each clip is transcribed on its own and keeps its own source timestamps; only the *output* timeline is shared. `trimClips` in `src/lib/silence.ts` runs the trim per clip and lays the results end to end, accumulating a frame offset — so a clip's position in the run never changes the `trimBefore`/`trimAfter` that read from its file.

`public/captions.json` therefore holds `{clips: [{src, isVideo, captions}]}`, and every `Segment` names the file it reads from. That is why the composition needs no `videoSrc`/`audioSrc` props: **the sources live in the transcript**, so `npm run render -- Captions out/v.mp4` works with no props at all. Video and audio clips mix freely in one run — each segment renders as `<OffthreadVideo>` or `<Audio>` according to its own `isVideo`.

`--from`/`--to` are rejected with several inputs: a window into *which* recording has no honest answer. Trim the clips first.

## Framing and movement

Footage is rendered through `<OffthreadVideo>` with `objectFit: cover`, which crops horizontal material to 9:16 rather than letterboxing it. Audio-only clips play over black. `src/lib/framing.ts` holds both knobs, as pure functions so the CLI can validate a flag without importing anything DOM-shaped:

```
npm run short -- clip.mp4 --crop=left --zoom
npm run render -- Captions out/v.mp4 --props='{"crop":"right","zoom":true}'
```

- `--crop=` — `center` (default), `left`, `right`, `top`, `bottom`. Picks which part of a wider source survives, via `objectPosition`. An unknown value is rejected at parse time rather than silently producing `undefined` in the style.
- `--zoom` — a slow Ken Burns push to `ZOOM_TO` (1.12) across the whole video.
- `--caption=` — `lower` (default), `center`, `upper`. Where the caption block sits vertically. `lower` keeps it in the bottom third but padded up 18%, clear of the platform's own buttons and description overlay.

The caption block is a wrapping flex **row**, so its lines run down the cross axis: `alignContent` moves them vertically, not `justifyContent` (that stays centred for horizontal centring). `captionLayoutFor` in `framing.ts` returns the `alignContent` plus a height-fraction padding.

- `--color=` — hex colour of the currently-spoken word (default `#fde047`). Validated at parse time; a named colour is rejected so a typo fails before a render, not after.
- `--fit` — `objectFit: contain` (whole frame, black bars) instead of `cover` (crop to 9:16). For screen recordings whose edges carry content. `--crop` is a no-op under `--fit`, since nothing is cropped away.

The zoom's one trap: it is driven by the **absolute** frame, computed in `CaptionedVideo` rather than inside the `<Series.Sequence>`. Inside a sequence the frame restarts at zero, so the push would snap back to 1.0 on every silence cut. Anything else animated across the whole video has to be computed in the same place, for the same reason.

Two layout facts that are easy to get wrong and invisible until a frame is rendered — both cost a render to find:

- The captions live in their own `<AbsoluteFill>`. The video layer is positioned, so a statically-positioned caption element is painted *underneath* it and disappears entirely.
- `AbsoluteFill` is `flex-direction: column`. Without `flex-row` every word stacks on its own line.

Expect video-backed renders to be far slower — see below — 20 seconds of 1080p footage took ~3m50s versus ~18s for the same captions on black, since `OffthreadVideo` extracts each frame with ffmpeg. Synthetic high-noise test footage is the worst case; real footage decodes faster.

To regenerate the throwaway background fixture (gitignored, needs system ffmpeg — Remotion's bundled build has most filters compiled out):

```
ffmpeg -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=22" -c:v libx264 -pix_fmt yuv420p -y public/sample-bg.mp4
```

## Where the agent lives

There is no agent binary in this repo, deliberately. Claude Code is the agent: it reads this file, runs the npm scripts, and edits compositions. Repeatable workflows are captured as skills in `.claude/skills/` rather than as code — `short-subtitulado` covers the audio → transcript → tuned render path end to end.

A standalone `scripts/agent.mts` on the Anthropic SDK was considered and deferred. It buys headless operation (CI, cron, someone else running it) and nothing else right now; the `lib/` split above is what makes it a short job when that need is real. Do not build it speculatively.

## Watermark and keyword overlays

Two branding layers, both Remotion-native because they use data an external editor lacks:

- `--handle=@you` — a small dimmed watermark, top-centre, over the whole video (hook included). Pure text, no asset.
- `overlays.json` at the repo root (gitignored; `overlays.example.json` is the template) maps `{"keyword": "image.png"}`. When the word is spoken, the image fades in over the upper third and holds until the word ends or `OVERLAY_HOLD_MS` (1300) passes, whichever is later — so a short word does not flash it. The images live in `public/`, referenced by filename; the map is auto-loaded by `short` into the `overlays` prop, so no flag is needed. `overlaysFromCaptions` in `src/lib/overlays.ts` resolves the timings from the captions (whole word, case-insensitive, punctuation ignored); `duckFactorAt`-style purity keeps it testable.

The keyword trigger is the one thing CapCut cannot do easily — it does not know the word timings. Hand-placed one-off gifs are faster in a visual editor; use `overlays.json` only for the images tied to specific words you say.

## Hook card

`--hook="MIRA ESTO"` holds a full-screen title card for 2 seconds (`HOOK_SECONDS` in `Captions.tsx`) before the video, in the accent `--color`. `calculateMetadata` adds `hookFrames` to `durationInFrames` and passes the count down, so the composition and the component never disagree about where the content begins.

The structural point: the card is a `<Sequence durationInFrames={hookFrames}>` and everything else lives in a sibling `<Sequence from={hookFrames}>`. That second `from` rebases `useCurrentFrame` to 0 for the content, so the captions and the ducking still time against the video rather than the hook. The content was split into an inner `CaptionedContent` for exactly this — and its zoom span is passed in as `durationInFrames - hookFrames`, since `useVideoConfig` would otherwise report the whole length including the card.

## Background music that ducks

`--music=song.mp3` lays a track over the whole video, ducked under speech. Like the silence cut, nothing analyses the audio — the word timings already say where the voice is. `src/lib/ducking.ts` returns a per-frame volume: `DEFAULT_DUCK.full` (0.55) in silence, `duck` (0.12) under a word, with a `rampMs` (200) glide on each edge so the level never clicks.

The music is one `<Audio loop>` at the top of the composition, outside the `<Series>`, so it plays continuously across every segment and loops to cover any length. Its `volume` prop is a function of the frame; the speech intervals come from the already-shifted captions, so ducking lands on the trimmed timeline, not the source one.

`duckFactorAt` takes the **max** across word intervals, so two words closer than a ramp never let the music bob back up in the gap between them. Verified end to end: on a rendered tone, the music sat ~11 dB quieter under words than in the gaps, and the dips lined up with the word times.

## Config

`remotion.config.ts` applies to the CLI and Studio **only** — it is ignored when rendering through the Node.js APIs (`@remotion/renderer`), where the same options must be passed to the API call directly. It currently sets JPEG frame format, overwrite-output, and wires Tailwind v4 in via `overrideWebpackConfig(enableTailwind)`. That last line is what makes Tailwind classes work; dropping Tailwind means removing it, `src/index.css`, and the `@remotion/tailwind-v4` + `tailwindcss` deps together.

Remotion packages are version-locked to each other — upgrade them as a set with `npm run upgrade`, never individually.

## Path to a SaaS

The long-term intent is to turn this into a product. It is intentionally **not** built yet: the compositions in `src/` are the actual value, and they are identical in a CLI and in a service, so the CLI phase is where the real work happens. Ship the owner's own content first; let the workflows that repeat reveal what deserves a UI.

Groundwork already in place, so nothing has to be untangled later:

- `scripts/lib/` returns values instead of printing them — an HTTP handler can import it as-is.
- Compositions read their inputs through props and `calculateMetadata`, not from hardcoded paths, so per-user data is already the shape they expect.

Constraints worth knowing **before** committing, not after:

- **Rendering does not belong on Vercel Functions.** A render is headless Chrome plus ffmpeg running for minutes. The supported paths are `@remotion/lambda` (AWS) or `@remotion/cloudrun`. Vercel is a fine host for the UI and API around them.
- **Remotion licensing.** Free for individuals and teams up to 3; a commercial product built on it needs a company license (remotion.pro). Check this before investing months, not after.
- **AssemblyAI bills per hour of audio.** Negligible for one person's content, a real line item with users.

When a web layer does arrive, it is additive: `app/` alongside the existing `src/` and `scripts/`, calling the same `lib/` functions. Nothing in the current tree needs to move.

## Agent style rules

Six generated rule files carry the same instruction — `AGENTS.md`, `.opencode/AGENTS.md`, `.cursor/rules/caveman.mdc` (`alwaysApply: true`), `.windsurf/rules/caveman.md`, `.clinerules/caveman.md`, `.github/copilot-instructions.md`. Written by `caveman-init`; regenerate rather than hand-editing one of the six.

Respond terse like smart caveman. All technical substance stay. Only fluff die.

- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: `[thing] [action] [reason]. [next step].`
- Not: "Sure! I'd be happy to help you with that." Yes: "Bug in auth middleware. Fix:"

Switch level: `/caveman lite|full|ultra|wenyan`. Stop: "stop caveman" or "normal mode".

Auto-Clarity: drop caveman for security warnings, irreversible actions, or when user confused. Resume after.

Boundaries: code, commits, and PR bodies written normal — the style governs prose only.
