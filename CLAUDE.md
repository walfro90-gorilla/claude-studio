# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Remotion 4.0.498 project (React + TypeScript video rendering), scaffolded from the `blank` template with Tailwind v4. React 19. Videos are React components; frames are rendered in headless Chrome and encoded by Remotion's bundled ffmpeg.

## Commands

```
npm run dev            # remotion studio — live preview at localhost:3000, the main dev loop
npm run lint           # eslint src scripts && tsc — lint + typecheck in one
npm run compositions   # list registered composition IDs
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

No test framework is installed, by design. Two checks cover the project: `node scripts/transcribe.mts --check` for the caption mapping, and a short `--frames=0-29` render for the video path — the cheapest proof that bundle, headless Chrome, and encoder all still work. Run the render check after touching composition code, `remotion.config.ts`, or webpack config.

## Layout

```
src/                    # video code only — bundled into the render
  index.ts              # registerRoot, the single Remotion entry point
  Root.tsx              # registers every composition; a video not listed here does not exist
  index.css             # Tailwind entry
  compositions/         # one file per video = one <Composition> declaration
  components/           # reusable pieces shared across compositions
scripts/                # console tools, run directly by Node — never bundled
  lib/                  # domain logic: no argv, no console, no process.exit
  transcribe.mts        # thin CLI shell over lib/
public/                 # runtime assets: audio, captions.json — served at the root
out/                    # renders, gitignored
.claude/skills/         # repeatable workflows Claude Code runs on request
```

Tracked vs ignored: `.claude/skills/` is committed (shared workflows) while `.claude/settings.local.json` is not (per-machine permissions). `public/` fixtures are committed; `out/`, `node_modules/`, and `.env` are not.

Two boundaries carry the design:

**`src` vs `scripts`** — `src` runs inside headless Chrome under Remotion's bundler; `scripts` runs in plain Node with filesystem and network access. Transcription, file IO, and API calls belong in `scripts` and hand results to `src` through `public/`. Do not import across that line.

**`scripts/lib` vs `scripts/*.mts`** — `lib/` holds pure domain functions that take arguments and return values. The `.mts` files at the top of `scripts/` are shells: parse argv, read env, write files, print. This split exists so the same functions can back an HTTP handler later without being untangled from CLI plumbing. Keep new logic in `lib/`; a shell should stay short enough to read at a glance.

## Architecture

Entry chain — adding a video means touching the last two:

- `src/index.ts` — calls `registerRoot(RemotionRoot)`. Nothing else should live here.
- `src/Root.tsx` — imports `./index.css` and renders each composition component.
- `src/compositions/Captions.tsx` — exports `Captions`, returning a `<Composition>` (id `Captions`, 1080x1920, 30fps) pointing at `CaptionedVideo`.
- `src/components/CaptionedVideo.tsx` — the actual video component.

`<Composition>` is a *declaration*, not a render: it registers an id plus dimensions/duration with Remotion. The CLI and Studio look compositions up by that id, so `id` is the public handle — renaming it breaks render commands and any CI referencing it. Register more videos by adding a file under `compositions/` and rendering it in `Root.tsx`.

`calculateMetadata` runs before render and can override duration, dimensions, and props dynamically. `Captions.tsx` uses it to `fetch(staticFile('captions.json'))` and set `durationInFrames` from the last caption's `endMs` — so a new transcript resizes the video with no code change. The `durationInFrames={1}` on the element is a placeholder that `calculateMetadata` always replaces.

The caption font is pinned: `CaptionedVideo.tsx` calls `loadFont` from `@remotion/google-fonts/Montserrat` at module scope and passes the returned `fontFamily` into the style. Without this the render inherits whatever font the rendering machine happens to have — DejaVu on this Linux box, something else on Lambda. Remotion blocks the render until the face is ready, so the first frames never draw in a fallback. Swap fonts by changing that one import and weight; both must exist in the Google Fonts catalog.

Inside a component, `useCurrentFrame()` drives all animation. Remotion renders each frame as a fresh, deterministic snapshot — the same frame number must always produce the same pixels, so no `Date.now()`, no `Math.random()`, no un-seeded state, and no animation driven by wall-clock time or CSS transitions.

`public/` is served at the root and is the only correct place for assets loaded at runtime; reference them with `staticFile('name.png')`, not a relative path.

## Captions (AssemblyAI → Remotion)

AssemblyAI complements Remotion rather than overlapping it: it turns audio into word-level timestamps, Remotion turns those into animated captions. `scripts/transcribe.mts` is the bridge.

```
npm run transcribe -- <audio-path-or-url> [out.json]   # key read from .env
node scripts/transcribe.mts --check                    # mapping self-check, no API call, no key
```

`ASSEMBLYAI_API_KEY` lives in `.env` (gitignored; `.env.example` is the template). Node loads it via `--env-file-if-exists` in the npm script. Output defaults to `public/captions.json`. Node runs the `.mts` directly via native type stripping — no build step, no ts-node.

The one non-obvious detail, and the reason the mapping isn't a plain field rename: `createTikTokStyleCaptions` from `@remotion/captions` splits pages on a **leading space** in `Caption.text` and otherwise concatenates tokens verbatim. AssemblyAI's words carry no leading space, so a naive mapping glues the whole transcript into a single unbreakable word. `wordsToCaptions` prepends a space to every word except the first; `--check` asserts exactly that and fails if it regresses.

`COMBINE_TOKENS_WITHIN_MS` in `CaptionedVideo.tsx` behaves as a *minimum page duration*, not a gap threshold — a page only breaks once it already spans that long. Lower it for faster cuts. It ignores silence, so a long pause mid-page does not force a break.

`public/sample.mp3` is a 20-second English news clip kept as a fixture, and `public/captions.json` holds its real transcript, so the composition renders out of the box. `npm run transcribe` overwrites the JSON — copy it aside first if it still matters.

## Footage behind the captions

`CaptionedVideo` takes two optional sources, both filenames inside `public/`:

- `videoSrc` — footage rendered through `<OffthreadVideo>` with `objectFit: cover`, which crops horizontal material to 9:16 around its centre rather than letterboxing it. The clip must be at least as long as the captions. Its own audio track plays.
- `audioSrc` — a separate audio file, for footage with no usable audio (or no footage at all).

Both default to `null`, so **the composition renders silent on black** unless they are passed:

```
npm run render -- Captions out/short.mp4 --props='{"videoSrc":"clip.mp4","audioSrc":"voz.mp3"}'
```

Two layout facts that are easy to get wrong and invisible until a frame is rendered — both cost a render to find:

- The captions live in their own `<AbsoluteFill>`. The video layer is positioned, so a statically-positioned caption element is painted *underneath* it and disappears entirely.
- `AbsoluteFill` is `flex-direction: column`. Without `flex-row` every word stacks on its own line.

Expect video-backed renders to be far slower — 20 seconds of 1080p footage took ~3m50s versus ~18s for the same captions on black, since `OffthreadVideo` extracts each frame with ffmpeg. Synthetic high-noise test footage is the worst case; real footage decodes faster.

To regenerate the throwaway background fixture (gitignored, needs system ffmpeg — Remotion's bundled build has most filters compiled out):

```
ffmpeg -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=22" -c:v libx264 -pix_fmt yuv420p -y public/sample-bg.mp4
```

## Where the agent lives

There is no agent binary in this repo, deliberately. Claude Code is the agent: it reads this file, runs the npm scripts, and edits compositions. Repeatable workflows are captured as skills in `.claude/skills/` rather than as code — `short-subtitulado` covers the audio → transcript → tuned render path end to end.

A standalone `scripts/agent.mts` on the Anthropic SDK was considered and deferred. It buys headless operation (CI, cron, someone else running it) and nothing else right now; the `lib/` split above is what makes it a short job when that need is real. Do not build it speculatively.

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
