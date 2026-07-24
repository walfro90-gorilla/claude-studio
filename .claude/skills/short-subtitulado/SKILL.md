---
name: short-subtitulado
description: Turn an audio or video file into a rendered vertical short with burned-in TikTok-style captions. Use when the user asks for a short, a reel, a subtitled clip, or says "transcribe and render this audio". Covers the full path - transcription, caption tuning, render, visual check.
---

# Short subtitulado

Audio or video in, rendered `.mp4` out.

## The fast path

When the caption settings are already right for this kind of material:

```
npm run short -- <file> [more files...] [--out=x.mp4] [--from=12] [--to=1:30] [--crop=left] [--zoom]
```

Every positional argument is an input, played in the order given — several files become one short, and video and audio clips can mix. The destination is `--out=`, defaulting to `out/short.mp4`.

`--from` / `--to` pick the take out of a longer recording; both accept seconds, `mm:ss` or `hh:mm:ss`. Only words spoken whole inside the window are kept, so the output starts on the first complete word after `--from` rather than exactly at it. They are rejected with several inputs — trim the clips first.

One command: copies the file into `public/`, transcribes it, cuts the silences, renders. A video input goes behind the captions and keeps its own audio; anything else plays over black.

The output is shorter than the input by design — pauses over 700ms are dropped. Tell the user how much came off; if they wanted the pauses, point them at `TRIM_SILENCE_OVER_MS` below rather than re-recording.

Use the four steps below instead when the material is new, the pacing needs tuning, or the render must be checked before committing minutes to it.

## The tuning path

Four steps; do not skip step 3.

## 1. Transcribe

```
npm run transcribe -- <audio-path-or-url>
```

Writes `public/captions.json` (overwrites the previous one — if the user may still want it, copy it aside first). Needs `ASSEMBLYAI_API_KEY` in `.env`; the npm script loads it. A minute of audio takes a few seconds.

This handles one file. For several clips in one short, use `npm run short` above — it transcribes each one and joins them.

If the audio language is known and detection has misfired, pass `languageCode` through `transcribeToCaptions` in `scripts/lib/captions.mts` rather than retrying blind.

## 2. Check the duration picked up

```
npm run compositions
```

`Captions` should report roughly the audio's length. If it reports ~0.5s, the transcript is empty — the audio path was wrong or the file has no speech. Fix that before rendering.

## 3. Tune the pacing, then look at a frame

Two knobs, in two different files, doing two different jobs:

- `COMBINE_TOKENS_WITHIN_MS` in `src/components/CaptionedVideo.tsx` is a **minimum page duration** — how long a caption page lasts before it can break. 800 suits fast speech; 1200-1500 suits calm narration.
- `TRIM_SILENCE_OVER_MS` in `src/compositions/Captions.tsx` is the **longest pause kept in the cut**. 700 is tight; raise it for deliberate delivery, set it to `null` to keep the media whole. `npm run compositions` shows the resulting length, which is the fastest way to see how much was cut.

Render one frame mid-sentence and actually look at it:

```
npm run still -- Captions out/frame.png --frame=110
```

Read the PNG. What to catch: text overflowing the safe area, a page so long it wraps to three lines, the active-word highlight landing on the wrong word.

## 4. Render

```
npm run render -- Captions out/short.mp4
```

For a quick sanity pass first: `npm run render -- Captions out/test.mp4 --frames=0-29`.

## Footage and audio

The sources live in `public/captions.json`, written by the transcribe step, so **no `--props` are needed** — `npm run render -- Captions out/short.mp4` picks up whatever was last transcribed. A video input plays behind the captions cropped to 9:16 around its centre and keeps its own audio; anything else plays over black.

A video-backed render is much slower than one on black (minutes, not seconds). Tune the pacing on stills first, render the video once at the end.

## Framing

- `--crop=` — `center` (default), `left`, `right`, `top`, `bottom`. Horizontal footage is cropped to 9:16, and this picks which part survives. If the speaker sits off to one side, this is the fix; a still is the only way to tell.
- `--zoom` — slow push across the whole video, so a locked-off shot does not read as a still frame.

Both are visual: render a still and look at it rather than reasoning about which side the subject is on.

## Notes

- Never hand-edit `public/captions.json` timings to fix pacing — change `COMBINE_TOKENS_WITHIN_MS`. The JSON is regenerated on every transcribe and hand edits are lost.
- Styling (font size, colors, stroke) lives in `CaptionedVideo.tsx`, not in the caption data.
