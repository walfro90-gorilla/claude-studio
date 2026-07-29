# Installing Claude Studio on a fresh machine

This repo *is* the system. The compositions in `src/`, the CLI in `scripts/`, and the
guidance in `CLAUDE.md` are the whole product — there is no separate installer and no
global state to recreate. Getting it running elsewhere means: clone, install, add one
API key, verify.

`MASTER-PROMPT.xml` is the same procedure written for Claude Code to execute. Paste it
into a fresh session on the new machine and it will do the steps below and check its own
work. This file is for the human doing the setup, or for reading when the prompt stops
to ask something.

---

## 1. Publish this repo first

The new machine pulls from a git remote. This repo has none yet, so create one from the
machine that already works:

```console
gh repo create claude-studio --private --source=. --remote=origin --push
```

Or, without the `gh` CLI, create an empty private repo in the web UI and then:

```console
git remote add origin git@github.com:<you>/claude-studio.git
git push -u origin main
```

Nothing secret is tracked — `.env`, `corrections.json`, `overlays.json`, `out/`, and your
own media in `public/` are all gitignored. Confirm before pushing:

```console
git status --porcelain --ignored | grep '^!!'   # everything here stays local
```

**No network between the machines?** Use a bundle instead of a remote:

```console
git bundle create claude-studio.bundle --all      # on this machine
git clone claude-studio.bundle claude-studio      # on the new one, after copying the file
```

The bundle is a single file (~3 MB) and reproduces the repo exactly. Every step below
applies unchanged after that clone.

---

## 2. Prerequisites on the new machine

| Requirement | Why | Check |
|---|---|---|
| **Node.js 22.18+** (24 LTS recommended) | `scripts/*.mts` run through native TypeScript type stripping — no build step, no ts-node. The npm scripts pass no `--experimental-strip-types` flag, so they need a Node where stripping is on by default: 22.18+ or 23.6+. Anything older cannot execute them. | `node -v` |
| **git** | Cloning. | `git --version` |
| **AssemblyAI API key** | Transcription. Free tier is enough to start. Get one at [assemblyai.com/app/api-keys](https://www.assemblyai.com/app/api-keys). | — |
| **~2 GB disk** | `node_modules` pulls a Chrome build and an ffmpeg build for Remotion. | `df -h .` |

Remotion ships its own Chrome and ffmpeg, so neither needs to be installed system-wide.

**System ffmpeg is optional but worth having.** Remotion's bundled build has most filters
compiled out, so anything you do *around* the render — inspecting a source file, building
proxies, checking the result — wants a real ffmpeg. On Debian/Ubuntu: `sudo apt install ffmpeg`.

---

## 3. Install

```console
git clone <your-repo-url> claude-studio
cd claude-studio
npm i
cp .env.example .env
```

Then open `.env` and paste the key after `ASSEMBLYAI_API_KEY=`.

Optional, both gitignored and both templated in the repo:

```console
cp corrections.example.json corrections.json   # misheard words -> the right spelling
cp overlays.example.json overlays.json         # keyword -> image shown when you say it
```

`corrections.json` is worth filling in early. The transcriber reliably mishears brand
names, and a fix there survives every re-run.

---

## 4. Verify, cheapest first

Run these in order. Each one catches a different class of failure, and each is more
expensive than the last.

```console
npm run check          # pure logic: caption mapping, silence cut, ducking, overlays
npm run lint           # eslint + tsc
npm run compositions   # must list: Captions
```

Then prove the render path — bundle, headless Chrome, and encoder all working together:

```console
npm run render -- Captions out/smoke.mp4 --frames=0-29
```

About 10–20 seconds. It renders the sample fixture (`public/sample.mp3` and its committed
transcript), so it works before you have supplied any media of your own.

**Layout and timing bugs survive all four of those.** The only check that catches them is
looking at a frame:

```console
npm run still -- Captions out/frame.png --frame=110
```

Open it. You should see white uppercase Montserrat captions with one word highlighted in
yellow, sitting in the lower third over black. If the text is missing, stacked one word
per line, or in the wrong font, see the layout traps in `CLAUDE.md`.

---

## 5. First real short

```console
npm run short -- your-recording.mp4 --lang=es
```

That transcribes, drops the silences, and writes `out/short.mp4`. Expect minutes, not
seconds, when there is video behind the captions — `OffthreadVideo` extracts every frame
with ffmpeg.

`README.md` has the flag table. `CLAUDE.md` has the design and the reasoning behind it.

---

## 6. Working with large or exotic source files

Not required for setup, but the first thing that bites on real footage.

`npm run short` uploads each input to AssemblyAI **whole, video track included**, and hands
the same file to Remotion to render from. Modern camera footage is a bad fit for both jobs:
a phone or drone clip can be 4K, 10-bit HEVC, 48–60 fps, and hundreds of megabytes per
minute. That means a slow upload and a very slow render.

Build 1080x1920 proxies first. The composition renders at 1080x1920 regardless, so
downscaling costs nothing you would have seen:

```console
ffmpeg -y -i source.MP4 -map 0:v:0 -map 0:a:0 \
  -vf scale=1080:1920 -r 30 \
  -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k public/clip-01.mp4
```

On a machine with an Intel iGPU, VAAPI does the same job dramatically faster — 135 seconds
of 3K HEVC transcoded in about a minute, where the libx264 command above at `-preset medium`
had not finished the first 17-second clip in eight minutes:

```console
ffmpeg -y -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 -hwaccel_output_format vaapi \
  -i source.MP4 -map 0:v:0 -map 0:a:0 \
  -vf 'scale_vaapi=w=1080:h=1920:format=nv12,fps=30' \
  -c:v h264_vaapi -qp 23 -c:a aac -b:a 192k public/clip-01.mp4
```

Check availability with `ls /dev/dri/` and `ffmpeg -encoders | grep vaapi`. Note
`format=nv12` — without it, 10-bit sources fail with `No usable encoding profile found`,
because the VAAPI H.264 encoder cannot take the 10-bit surface the decoder produced.
`-map 0:v:0` matters too: camera files often carry an extra MJPEG thumbnail stream that
ffmpeg would otherwise try to transcode.

Then feed the proxies, in order:

```console
npm run short -- public/clip-01.mp4 public/clip-02.mp4 --out=out/final.mp4 --lang=es
```

---

## What does *not* transfer

- **`.env`** — the API key. Recreate it, never commit it.
- **`corrections.json` / `overlays.json`** — your personal maps. Copy them across by hand
  if you want them; the `.example.json` versions are the tracked templates.
- **`public/` media** — only `sample.mp3` and its `captions.json` are tracked. Everything
  else is your own footage, deliberately ignored.
- **`out/`** — renders. Regenerate them.
- **`.claude/settings.local.json`** — per-machine Claude Code permissions. The new machine
  builds its own as you approve tools.

`.claude/skills/` **is** tracked, so the `short-subtitulado` workflow travels with the repo
and is available in the new Claude Code session immediately.
