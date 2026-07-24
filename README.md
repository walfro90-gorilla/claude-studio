# Claude Studio

Console-driven video studio. A recording goes in, a vertical short with burned-in captions comes out — transcribed, trimmed, and cut, in one command.

Built on [Remotion](https://remotion.dev) (video as React components) and [AssemblyAI](https://assemblyai.com) (word-level transcription).

## Setup

```console
npm i
cp .env.example .env      # then paste your key from assemblyai.com/app/api-keys
```

## Make a short

```console
npm run short -- recording.mp4
```

Transcribes the file, drops the silences, and renders `out/short.mp4` at 1080x1920.

```console
npm run short -- a.mp4 b.mp4 --out=out/reel.mp4    # several clips, played in order
npm run short -- talk.mp4 --from=1:30 --to=2:15    # just this take
npm run short -- clip.mp4 --crop=left --zoom       # reframe, and add a slow push
```

Every positional argument is an input; the destination is `--out=` (default `out/short.mp4`). A video input plays behind the captions cropped to 9:16; audio plays over black. Video and audio clips mix freely in one run.

`.mp4 .mov .mkv .webm .avi .m4v` all work as-is — no conversion step. Audio goes in whatever AssemblyAI accepts (`.mp3`, `.wav`, `.m4a`, …).

Each run prints the language it transcribed in — `49 words, detected es (99% sure)` — so a misdetection shows up there rather than in the finished video. Pin it with `--lang=es` when you already know.

| Flag | Does |
|---|---|
| `--out=` | Where to write. Default `out/short.mp4`. |
| `--from=` `--to=` | Manual in/out points. Seconds, `mm:ss` or `hh:mm:ss`. One input only. |
| `--crop=` | `center` (default), `left`, `right`, `top`, `bottom`. |
| `--zoom` | Slow Ken Burns push across the whole video. |
| `--lang=` | Pin the transcription language (`es`, `en_us`, …). Detected otherwise. |
| `--caption=` | `lower` (default), `center`, `upper`. Where captions sit vertically. |
| `--color=` | Highlight colour of the spoken word, hex (default `#fde047`). |
| `--fit` | Fit the whole frame with bars instead of cropping to 9:16. For screen recordings. |
| `--music=` | Background track, ducked under speech. Any audio file. |

Expect the output to be shorter than the input: pauses over 700ms are cut. Video-backed renders take minutes, audio-over-black takes seconds.

## Tuning

Two constants decide the feel. Change them, render one still, look at it.

- `COMBINE_TOKENS_WITHIN_MS` in `src/components/CaptionedVideo.tsx` — minimum caption page duration. Lower is snappier. 800 suits fast speech, 1200–1500 calm narration.
- `TRIM_SILENCE_OVER_MS` in `src/compositions/Captions.tsx` — longest pause kept. `null` keeps the recording whole.

Font, size, colour, and stroke live in `CaptionedVideo.tsx`.

**Fixing misheard names.** Copy `corrections.example.json` to `corrections.json` and fill it with `"misheard": "correct"` pairs — the transcriber tends to mangle brand and product names. It is applied on every run, so a fix sticks.

## Other commands

```console
npm run dev            # Remotion Studio — live preview at localhost:3000
npm run check          # self-checks for the caption mapping, the cut, and the framing
npm run lint           # eslint + tsc
npm run transcribe     # transcription only, without rendering
npm run compositions   # list composition IDs and their resolved lengths
npm run still  -- Captions out/frame.png --frame=110
npm run render -- Captions out/video.mp4
npm run upgrade        # bump all Remotion packages together
```

`npm run compositions` is the fastest sanity check after transcribing: it reports the length the cut produced.

## Layout

```
src/          video code — bundled into the render
  compositions/   one file per video
  components/     the caption video itself
  lib/            the silence cut and the framing, both pure
scripts/      console tools, plain Node
  lib/            domain logic, no argv or console
public/       runtime assets — media and captions.json
out/          renders (gitignored)
```

`CLAUDE.md` documents the architecture, the render traps, and the reasoning behind each decision.

## License

Remotion is free for individuals and small teams, but **a company license is required for larger organisations** — [read the terms](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md). AssemblyAI bills per hour of audio.
