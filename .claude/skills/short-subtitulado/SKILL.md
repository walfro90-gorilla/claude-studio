---
name: short-subtitulado
description: Turn an audio or video file into a rendered vertical short with burned-in TikTok-style captions. Use when the user asks for a short, a reel, a subtitled clip, or says "transcribe and render this audio". Covers the full path - transcription, caption tuning, render, visual check.
---

# Short subtitulado

Audio in, rendered `.mp4` out. Four steps; do not skip step 3.

## 1. Transcribe

```
npm run transcribe -- <audio-path-or-url>
```

Writes `public/captions.json` (overwrites the previous one — if the user may still want it, copy it aside first). Needs `ASSEMBLYAI_API_KEY` in `.env`; the npm script loads it. A minute of audio takes a few seconds.

If the audio language is known and detection has misfired, pass `languageCode` through `transcribeToCaptions` in `scripts/lib/captions.mts` rather than retrying blind.

## 2. Check the duration picked up

```
npm run compositions
```

`Captions` should report roughly the audio's length. If it reports ~0.5s, the transcript is empty — the audio path was wrong or the file has no speech. Fix that before rendering.

## 3. Tune the pacing, then look at a frame

`COMBINE_TOKENS_WITHIN_MS` in `src/components/CaptionedVideo.tsx` is a **minimum page duration**, not a silence threshold. Lower = shorter pages, faster cuts. 800 suits fast speech; 1200-1500 suits calm narration.

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

## Audio in the video

The composition accepts an `audioSrc` prop, `null` by default, so **the render is silent unless it is set**. Put the audio file in `public/` and pass the filename:

```
npm run render -- Captions out/short.mp4 --props='{"audioSrc":"voz.mp3"}'
```

## Notes

- Never hand-edit `public/captions.json` timings to fix pacing — change `COMBINE_TOKENS_WITHIN_MS`. The JSON is regenerated on every transcribe and hand edits are lost.
- Styling (font size, colors, stroke) lives in `CaptionedVideo.tsx`, not in the caption data.
