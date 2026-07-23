// One command: media file in, subtitled vertical short out.
//   npm run short -- <audio-or-video> [out.mp4]
//   node scripts/short.mts --check      # self-check, no API call, no render
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Caption } from "@remotion/captions";
import { transcribeToCaptions } from "./lib/captions.mts";
import { isVideo, propsForInput } from "./lib/short.mts";
// Crossing into src/ is safe here and only here: silence.ts is pure, imports
// nothing but a type, and touches neither the DOM nor the filesystem.
import { trimSilence } from "../src/lib/silence.ts";

const PUBLIC_DIR = resolve("public");
const CAPTIONS_OUT = resolve(PUBLIC_DIR, "captions.json");

const check = () => {
  if (!isVideo("clip.MP4")) throw new Error("extension match must ignore case");
  if (isVideo("voz.mp3")) throw new Error("mp3 is not video");

  const video = propsForInput("clip.mp4");
  if (video.videoSrc !== "clip.mp4" || video.audioSrc !== null) {
    throw new Error("video input must become videoSrc alone");
  }
  const audio = propsForInput("voz.mp3");
  if (audio.audioSrc !== "voz.mp3" || audio.videoSrc !== null) {
    throw new Error("audio input must become audioSrc alone");
  }

  checkSilence();
  console.log("ok");
};

// Two words, then four seconds of nothing, then two more.
const SPEECH: Caption[] = [
  { text: "uno", startMs: 0, endMs: 400, timestampMs: 200, confidence: 1 },
  { text: " dos", startMs: 420, endMs: 800, timestampMs: 610, confidence: 1 },
  { text: " tres", startMs: 4800, endMs: 5200, timestampMs: 5000, confidence: 1 },
  { text: " cuatro", startMs: 5220, endMs: 5600, timestampMs: 5410, confidence: 1 },
];

const checkSilence = () => {
  const fps = 30;
  const cut = trimSilence({ captions: SPEECH, fps, maxGapMs: 700, padMs: 150 });

  if (cut.segments.length !== 2) {
    throw new Error(`one four-second gap must yield 2 segments, got ${cut.segments.length}`);
  }
  // 0.95s + 1.1s of speech survives the 4s hole: 28.5 and 33 frames, each
  // rounded to whole frames on its own.
  if (cut.durationInFrames !== 62) {
    throw new Error(`expected 62 frames of speech, got ${cut.durationInFrames}`);
  }
  if (cut.captions.length !== SPEECH.length) {
    throw new Error("trimming must keep every word");
  }
  // "tres" sat at 4.8s. After the cut it must land where the second segment
  // starts playing, plus the padding kept in front of it.
  const tres = cut.captions[2];
  const expected =
    (cut.segments[0].durationInFrames / fps) * 1000 + /* padMs */ 150;
  if (Math.abs(tres.startMs - expected) > 1000 / fps) {
    throw new Error(
      `third word should shift to ~${Math.round(expected)}ms, landed at ${tres.startMs}ms`,
    );
  }
  if (cut.captions.some((c, i) => c.text !== SPEECH[i].text)) {
    throw new Error("shifting must not touch the text, leading spaces included");
  }
  // Every caption has to stay inside the shortened timeline.
  const endOfVideo = (cut.durationInFrames / fps) * 1000;
  if (cut.captions.some((c) => c.startMs < 0 || c.endMs > endOfVideo)) {
    throw new Error("a caption fell outside the trimmed timeline");
  }

  const whole = trimSilence({ captions: SPEECH, fps, maxGapMs: null, padMs: 150 });
  if (whole.segments.length !== 1) {
    throw new Error("maxGapMs null must leave the media in one piece");
  }
  if (whole.captions[2].startMs !== 4800) {
    throw new Error("untrimmed captions must keep their original times");
  }

  const empty = trimSilence({ captions: [], fps, maxGapMs: 700, padMs: 150 });
  if (empty.segments.length !== 0 || empty.durationInFrames !== 0) {
    throw new Error("no words must produce no segments");
  }
};

/** Compositions can only read from public/, so anything outside it is copied in. */
const ensureInPublic = (input: string): string => {
  const source = resolve(input);
  if (!existsSync(source)) {
    throw new Error(`no such file: ${input}`);
  }
  const name = basename(source);
  const target = resolve(PUBLIC_DIR, name);
  if (source !== target) {
    copyFileSync(source, target);
    console.log(`copied ${name} into public/`);
  }
  return name;
};

const main = async () => {
  const [input, out = "out/short.mp4"] = process.argv.slice(2);
  if (input === "--check") {
    return check();
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!input || !apiKey) {
    throw new Error(
      "usage: npm run short -- <audio-or-video> [out.mp4]  (needs ASSEMBLYAI_API_KEY in .env)",
    );
  }

  const name = ensureInPublic(input);

  // ponytail: the file is uploaded to AssemblyAI whole, video track included.
  // Strip the audio out with ffmpeg first if the uploads get painful.
  console.log(`transcribing ${name}...`);
  const captions = await transcribeToCaptions({
    audio: resolve(PUBLIC_DIR, name),
    apiKey,
  });
  writeFileSync(CAPTIONS_OUT, JSON.stringify(captions, null, 2));
  console.log(`${captions.length} words -> public/captions.json`);

  const props = JSON.stringify(propsForInput(name));
  console.log(`rendering ${out}${isVideo(name) ? " (video behind captions — this takes minutes)" : ""}`);
  const render = spawnSync(
    "npx",
    ["remotion", "render", "Captions", out, `--props=${props}`],
    { stdio: "inherit" },
  );
  if (render.status !== 0) {
    throw new Error(`render failed with code ${render.status}`);
  }
};

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
