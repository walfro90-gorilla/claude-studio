// One command: media files in, one subtitled vertical short out.
//   npm run short -- <file> [more files...] [--out=x.mp4] [--from=12] [--to=1:30]
//   node scripts/short.mts --check      # self-check, no API call, no render
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Caption } from "@remotion/captions";
import { transcribeToCaptions } from "./lib/captions.mts";
import { clipForInput, isVideo, parseArgs, parseTime } from "./lib/short.mts";
// Crossing into src/ is safe here and only here: silence.ts is pure, imports
// nothing but a type, and touches neither the DOM nor the filesystem.
import { trimClips, trimSilence } from "../src/lib/silence.ts";

const PUBLIC_DIR = resolve("public");
const CAPTIONS_OUT = resolve(PUBLIC_DIR, "captions.json");

const check = () => {
  if (!isVideo("clip.MP4")) throw new Error("extension match must ignore case");
  if (isVideo("voz.mp3")) throw new Error("mp3 is not video");

  const video = clipForInput("clip.mp4");
  if (video.src !== "clip.mp4" || !video.isVideo) {
    throw new Error("a video input must be marked as video");
  }
  const audio = clipForInput("voz.mp3");
  if (audio.src !== "voz.mp3" || audio.isVideo) {
    throw new Error("an audio input must not be marked as video");
  }

  checkSilence();
  checkConcat();
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

  const parsed = parseArgs(["clip.mp4", "--from=1:30", "--out=v.mp4", "--to=100"]);
  if (parsed.inputs.join() !== "clip.mp4") {
    throw new Error("flags must be stripped, leaving only the inputs");
  }
  if (parsed.out !== "v.mp4") throw new Error("--out must set the destination");
  if (parsed.window.clipStartMs !== 90_000 || parsed.window.clipEndMs !== 100_000) {
    throw new Error("--from/--to must land in the window");
  }

  // Several inputs are several clips, in the order they were given.
  const many = parseArgs(["a.mp4", "b.mp3", "c.mov"]);
  if (many.inputs.join() !== "a.mp4,b.mp3,c.mov") {
    throw new Error("every positional argument is an input, order kept");
  }
  if (many.out !== "out/short.mp4") throw new Error("--out must have a default");

  for (const [argv, why] of [
    [["--from=30", "--to=10"], "--to before --from"],
    [["a.mp4", "b.mp4", "--from=5"], "a window across several inputs"],
  ] as const) {
    let threw = false;
    try {
      parseArgs([...argv]);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`${why} must be rejected`);
  }

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

const checkConcat = () => {
  const fps = 30;
  const options = { fps, maxGapMs: 700, padMs: 150 };
  const clips = [
    { src: "a.mp4", isVideo: true, captions: SPEECH },
    { src: "b.mp3", isVideo: false, captions: SPEECH },
  ];
  const joined = trimClips({ clips, ...options });
  const alone = trimSilence({ captions: SPEECH, ...options });

  if (joined.durationInFrames !== alone.durationInFrames * 2) {
    throw new Error(
      `two identical clips must run twice as long: ${joined.durationInFrames} vs ${alone.durationInFrames * 2}`,
    );
  }
  if (joined.segments.length !== alone.segments.length * 2) {
    throw new Error("every clip must contribute its own segments");
  }
  if (joined.captions.length !== SPEECH.length * 2) {
    throw new Error("no words may be lost at the joint");
  }

  // Each segment must read from its own file, and keep its own source times —
  // only the OUTPUT timeline is shared.
  const perClip = alone.segments.length;
  if (joined.segments.slice(0, perClip).some((s) => s.src !== "a.mp4")) {
    throw new Error("the first clip's segments must read from the first file");
  }
  if (joined.segments.slice(perClip).some((s) => s.src !== "b.mp3")) {
    throw new Error("the second clip's segments must read from the second file");
  }
  if (joined.segments.slice(perClip).some((s) => !s.isVideo !== true)) {
    throw new Error("an audio clip must not be rendered as video");
  }
  joined.segments.slice(perClip).forEach((segment, i) => {
    if (segment.trimBefore !== alone.segments[i].trimBefore) {
      throw new Error("source trim points must not shift with the clip's position");
    }
  });

  // The second clip's captions must sit after the first clip ends, and the
  // whole run must stay inside the declared duration.
  const firstEndsMs = (alone.durationInFrames / fps) * 1000;
  const second = joined.captions.slice(SPEECH.length);
  if (second.some((c) => c.startMs < firstEndsMs - 1000 / fps)) {
    throw new Error("the second clip's captions must not play during the first");
  }
  const endMs = (joined.durationInFrames / fps) * 1000;
  if (joined.captions.some((c) => c.startMs < 0 || c.endMs > endMs)) {
    throw new Error("a caption fell outside the joint timeline");
  }
  // Segment durations must add up to the declared total, or Series and the
  // composition disagree about where the video ends.
  const summed = joined.segments.reduce((n, s) => n + s.durationInFrames, 0);
  if (summed !== joined.durationInFrames) {
    throw new Error(`segments sum to ${summed}, duration says ${joined.durationInFrames}`);
  }

  if (trimClips({ clips: [], ...options }).durationInFrames !== 0) {
    throw new Error("no clips must produce nothing");
  }
  // A clip whose words were all filtered out must not break the ones after it.
  const withEmpty = trimClips({
    clips: [
      { src: "a.mp4", isVideo: true, captions: [] },
      { src: "b.mp3", isVideo: false, captions: SPEECH },
    ],
    ...options,
  });
  if (withEmpty.durationInFrames !== alone.durationInFrames) {
    throw new Error("an empty clip must contribute nothing and break nothing");
  }
  if (withEmpty.segments.some((s) => s.src !== "b.mp3")) {
    throw new Error("an empty clip must contribute no segments");
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
  if (process.argv[2] === "--check") {
    return check();
  }
  const { inputs, out, window } = parseArgs(process.argv.slice(2));

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (inputs.length === 0 || !apiKey) {
    throw new Error(
      "usage: npm run short -- <file> [more files...] [--out=x.mp4] [--from=12] [--to=1:30]\n" +
        "       (needs ASSEMBLYAI_API_KEY in .env)",
    );
  }

  const names = inputs.map(ensureInPublic);
  const clips = [];

  // Transcribed one at a time rather than in parallel: AssemblyAI rate-limits
  // per account, and a short is a handful of clips, not hundreds.
  for (const name of names) {
    console.log(`transcribing ${name}...`);
    // ponytail: the file is uploaded whole, video track included. Strip the
    // audio out with ffmpeg first if the uploads get painful.
    const captions = await transcribeToCaptions({
      audio: resolve(PUBLIC_DIR, name),
      apiKey,
    });
    console.log(`  ${captions.length} words`);
    clips.push({ ...clipForInput(name), captions });
  }

  writeFileSync(CAPTIONS_OUT, JSON.stringify({ clips }, null, 2));
  console.log(`${clips.length} clip(s) -> public/captions.json`);

  const props = JSON.stringify(window);
  console.log(`rendering ${out}${names.some(isVideo) ? " (video behind captions — this takes minutes)" : ""}`);
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
