// One command: media file in, subtitled vertical short out.
//   npm run short -- <audio-or-video> [out.mp4]
//   node scripts/short.mts --check      # self-check, no API call, no render
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Caption } from "@remotion/captions";
import { transcribeToCaptions } from "./lib/captions.mts";
import { isVideo, parseArgs, parseTime, propsForInput } from "./lib/short.mts";
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
  checkClip();
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

const checkClip = () => {
  const fps = 30;

  if (parseTime("90") !== 90_000) throw new Error("plain seconds");
  if (parseTime("1:30") !== 90_000) throw new Error("mm:ss");
  if (parseTime("1:02:03") !== 3_723_000) throw new Error("hh:mm:ss");
  if (parseTime("1.5") !== 1500) throw new Error("fractional seconds");
  for (const bad of ["", "abc", "1:2:3:4", "-5", "1:"]) {
    let threw = false;
    try {
      parseTime(bad);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`parseTime must reject ${JSON.stringify(bad)}`);
  }

  const parsed = parseArgs(["clip.mp4", "--from=1:30", "out.mp4", "--to=100"]);
  if (parsed.rest.join() !== "clip.mp4,out.mp4") {
    throw new Error("flags must be stripped and the order of the rest kept");
  }
  if (parsed.window.clipStartMs !== 90_000 || parsed.window.clipEndMs !== 100_000) {
    throw new Error("--from/--to must land in the window");
  }
  let inverted = false;
  try {
    parseArgs(["--from=30", "--to=10"]);
  } catch {
    inverted = true;
  }
  if (!inverted) throw new Error("--to before --from must be rejected");

  // A word straddling either edge is dropped whole: keeping it would clip its
  // audio mid-syllable, and at the in-point its caption would shift to a
  // negative time and never be drawn. "dos" ends at 800, "tres" starts at 4800.
  const straddling = trimSilence({
    captions: SPEECH,
    fps,
    maxGapMs: 700,
    padMs: 150,
    clipStartMs: 600,
    clipEndMs: 5000,
  });
  if (straddling.captions.some((c) => c.startMs < 0)) {
    throw new Error("a caption shifted to a negative time — it would never draw");
  }
  if (straddling.captions.some((c) => c.text.trim() === "dos")) {
    throw new Error("a word crossing the in-point must be dropped, not clipped");
  }
  if (straddling.captions.some((c) => c.text.trim() === "cuatro")) {
    throw new Error("a word crossing the out-point must be dropped, not clipped");
  }

  // Window over the middle: only "tres"/"cuatro" are inside it.
  const clipped = trimSilence({
    captions: SPEECH,
    fps,
    maxGapMs: 700,
    padMs: 150,
    clipStartMs: 4000,
    clipEndMs: 6000,
  });
  if (clipped.captions.length !== 2) {
    throw new Error(`window must drop outside words, kept ${clipped.captions.length}`);
  }
  if (clipped.captions[0].text !== " tres") {
    throw new Error(`window kept the wrong first word: ${clipped.captions[0].text}`);
  }
  // Nothing may be read from before the in-point or past the out-point.
  const firstFrame = clipped.segments[0].trimBefore;
  const lastFrame = clipped.segments[clipped.segments.length - 1].trimAfter;
  if (firstFrame < (4000 / 1000) * fps) {
    throw new Error(`segment starts before the in-point: frame ${firstFrame}`);
  }
  if (lastFrame > (6000 / 1000) * fps) {
    throw new Error(`segment runs past the out-point: frame ${lastFrame}`);
  }
  // The first surviving word must start at the top of the output, give or take
  // the padding deliberately kept in front of it.
  if (clipped.captions[0].startMs > 150 + 1000 / fps) {
    throw new Error(`clipped audio must start promptly, got ${clipped.captions[0].startMs}ms`);
  }

  // Window plus maxGapMs null: one segment, exactly the window.
  const whole = trimSilence({
    captions: SPEECH,
    fps,
    maxGapMs: null,
    padMs: 150,
    clipStartMs: 200,
    clipEndMs: 5000,
  });
  if (whole.segments.length !== 1) throw new Error("untrimmed window must be one piece");
  if (whole.segments[0].trimBefore !== msToFrames(200, fps)) {
    throw new Error("untrimmed window must honour the in-point");
  }
  if (whole.segments[0].trimAfter !== msToFrames(5000, fps)) {
    throw new Error("untrimmed window must honour the out-point");
  }

  // A window with no words in it renders nothing rather than everything.
  const none = trimSilence({
    captions: SPEECH,
    fps,
    maxGapMs: 700,
    padMs: 150,
    clipStartMs: 9000,
    clipEndMs: 9500,
  });
  if (none.segments.length !== 0 || none.durationInFrames !== 0) {
    throw new Error("an empty window must produce no segments");
  }
};

const msToFrames = (ms: number, fps: number) => Math.round((ms / 1000) * fps);

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
  const { rest, window } = parseArgs(process.argv.slice(2));
  const [input, out = "out/short.mp4"] = rest;
  if (input === "--check") {
    return check();
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!input || !apiKey) {
    throw new Error(
      "usage: npm run short -- <audio-or-video> [out.mp4] [--from=12] [--to=1:30]\n" +
        "       (needs ASSEMBLYAI_API_KEY in .env)",
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

  const props = JSON.stringify({ ...propsForInput(name), ...window });
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
