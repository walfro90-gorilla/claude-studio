// One command: media files in, one subtitled vertical short out.
//   npm run short -- <file> [more files...] [--out=x.mp4] [--from=12] [--to=1:30]
//   node scripts/short.mts --check      # self-check, no API call, no render
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import type { Caption } from "@remotion/captions";
import { transcribeToCaptions } from "./lib/captions.mts";
import { clipForInput, isVideo, parseArgs, parseTime } from "./lib/short.mts";
import { applyCorrections, isLanguageCode } from "./lib/captions.mts";
import { loadCorrections } from "./lib/corrections.mts";
// Crossing into src/ is safe here and only here: silence.ts is pure, imports
// nothing but a type, and touches neither the DOM nor the filesystem.
import { trimClips, trimSilence } from "../src/lib/silence.ts";
import { musicVolumeAt } from "../src/lib/ducking.ts";
import {
  CAPTION_POSITIONS,
  CROPS,
  DEFAULT_COLOR,
  ZOOM_TO,
  captionLayoutFor,
  isHexColor,
  objectPositionFor,
  zoomScaleAt,
} from "../src/lib/framing.ts";

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
  checkCorrections();
  checkDucking();
  console.log("ok");
};

const checkDucking = () => {
  const opts = { full: 0.6, duck: 0.1, rampMs: 200 };
  const speech = [{ startMs: 1000, endMs: 2000 }];

  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  // Full in silence, ducked under the word, and never outside [duck, full].
  if (!near(musicVolumeAt(0, speech, opts), 0.6)) throw new Error("silence must be full volume");
  if (!near(musicVolumeAt(1500, speech, opts), 0.1)) throw new Error("speech must duck");
  for (const ms of [0, 800, 900, 1000, 1500, 2100, 3000]) {
    const v = musicVolumeAt(ms, speech, opts);
    if (v < opts.duck - 1e-9 || v > opts.full + 1e-9) {
      throw new Error(`volume ${v} out of range at ${ms}ms`);
    }
  }
  // The ramp is monotonic into the word and back out — no click, no overshoot.
  if (!(musicVolumeAt(850, speech, opts) > musicVolumeAt(950, speech, opts))) {
    throw new Error("volume must fall approaching a word");
  }
  if (!(musicVolumeAt(2050, speech, opts) < musicVolumeAt(2150, speech, opts))) {
    throw new Error("volume must rise leaving a word");
  }
  // The midpoint of the ramp sits halfway between the two levels.
  const mid = musicVolumeAt(1000 - opts.rampMs / 2, speech, opts);
  if (Math.abs(mid - (opts.full + opts.duck) / 2) > 1e-9) {
    throw new Error(`ramp midpoint should be halfway, got ${mid}`);
  }
  // Two words closer than a ramp apart must not let the music bob back up to
  // full in the gap: overlapping ramps keep it well below halfway.
  const close = [
    { startMs: 1000, endMs: 1100 },
    { startMs: 1150, endMs: 1300 },
  ];
  if (musicVolumeAt(1125, close, opts) >= (opts.full + opts.duck) / 2) {
    throw new Error("a short gap between words must stay mostly ducked");
  }
  // Touching words keep the duck solid the whole way through.
  const touching = [
    { startMs: 1000, endMs: 1100 },
    { startMs: 1100, endMs: 1300 },
  ];
  if (!near(musicVolumeAt(1100, touching, opts), opts.duck)) {
    throw new Error("touching words must stay fully ducked at the seam");
  }
  // No music, no ducking data: full volume everywhere.
  if (!near(musicVolumeAt(1500, [], opts), 0.6)) {
    throw new Error("no speech must leave the music at full volume");
  }
};

const checkCorrections = () => {
  const caps = [
    { text: "cloud", startMs: 0, endMs: 300, timestampMs: 150, confidence: 1 },
    { text: " Cloud.", startMs: 400, endMs: 700, timestampMs: 550, confidence: 1 },
    { text: " CLOUD", startMs: 800, endMs: 1100, timestampMs: 950, confidence: 1 },
    { text: " otro", startMs: 1200, endMs: 1500, timestampMs: 1350, confidence: 1 },
  ];
  const fixed = applyCorrections(caps, { cloud: "Claude" });

  if (fixed[0].text !== "Claude") throw new Error("first word keeps no leading space");
  if (fixed[1].text !== " Claude.") throw new Error("trailing punctuation must survive");
  if (fixed[2].text !== " CLAUDE") throw new Error("an all-caps word must stay all-caps");
  if (fixed[3].text !== " otro") throw new Error("a non-match must be left untouched");
  // Timing and everything else must pass through unchanged.
  if (fixed[0].startMs !== 0 || fixed[1].endMs !== 700) {
    throw new Error("corrections must not touch timing");
  }
  // An empty map is the common case and must be a no-op.
  if (applyCorrections(caps, {}) !== caps) {
    throw new Error("no corrections must be a cheap no-op");
  }
  // The map key matches case-insensitively too.
  if (applyCorrections([caps[2]], { CLOUD: "Claude" })[0].text !== " CLAUDE") {
    throw new Error("the map key must match case-insensitively");
  }
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
  if (parsed.props.clipStartMs !== 90_000 || parsed.props.clipEndMs !== 100_000) {
    throw new Error("--from/--to must land in the window");
  }
  if (parsed.props.crop !== "center" || parsed.props.zoom) {
    throw new Error("framing must default to a centred crop and no zoom");
  }

  // Several inputs are several clips, in the order they were given.
  const many = parseArgs(["a.mp4", "b.mp3", "c.mov"]);
  if (many.inputs.join() !== "a.mp4,b.mp3,c.mov") {
    throw new Error("every positional argument is an input, order kept");
  }
  if (many.out !== "out/short.mp4") throw new Error("--out must have a default");

  const framed = parseArgs([
    "a.mp4",
    "--crop=left",
    "--zoom",
    "--caption=upper",
    "--fit",
  ]);
  if (framed.props.crop !== "left" || !framed.props.zoom) {
    throw new Error("--crop/--zoom must reach the props");
  }
  if (framed.props.caption !== "upper") {
    throw new Error("--caption must reach the props");
  }
  if (!framed.props.fit) throw new Error("--fit must reach the props");
  if (parseArgs(["a.mp4"]).props.fit) throw new Error("fit must default to off (cover)");

  // Music is captured as a raw path (main copies it in); no music means none.
  if (parseArgs(["a.mp4", "--music=song.mp3"]).music !== "song.mp3") {
    throw new Error("--music must be captured as a path");
  }
  if (parseArgs(["a.mp4"]).music !== null) {
    throw new Error("no --music must mean no music");
  }

  // --hook text reaches the props verbatim (spaces and all); none means null.
  if (parseArgs(["a.mp4", "--hook=Mira esto"]).props.hook !== "Mira esto") {
    throw new Error("--hook text must reach the props verbatim");
  }
  if (parseArgs(["a.mp4"]).props.hook !== null) {
    throw new Error("no --hook must mean no card");
  }
  if (framed.inputs.join() !== "a.mp4") {
    throw new Error("valueless flags must not be read as inputs");
  }
  // The short-form default sits low, out of the platform UI, not centred.
  if (parseArgs(["a.mp4"]).props.caption !== "lower") {
    throw new Error("captions must default to the lower third");
  }

  const colored = parseArgs(["a.mp4", "--color=#00e5ff"]);
  if (colored.props.color !== "#00e5ff") throw new Error("--color must reach the props");
  if (parseArgs(["a.mp4"]).props.color !== DEFAULT_COLOR) {
    throw new Error("the highlight must default to the brand yellow");
  }
  for (const good of ["#f00", "#ff0000", "#ff0000aa", "#ABCDEF"]) {
    if (!isHexColor(good)) throw new Error(`${good} is a valid hex colour`);
  }
  for (const bad of ["red", "#gggggg", "ff0000", "#ff00", ""]) {
    if (isHexColor(bad)) throw new Error(`${JSON.stringify(bad)} is not a hex colour`);
  }
  if (framed.languageCode !== null) {
    throw new Error("no --lang must mean detection, not a guessed default");
  }

  const spanish = parseArgs(["voz.mp3", "--lang=es"]);
  if (spanish.languageCode !== "es") throw new Error("--lang must reach the transcriber");
  // The language is a transcription setting, not something the render sees.
  if ("languageCode" in spanish.props) {
    throw new Error("--lang must not leak into the render props");
  }
  for (const good of ["es", "en", "en_us", "de_ch", "zh"]) {
    if (!isLanguageCode(good)) throw new Error(`${good} is a real code`);
  }
  for (const bad of ["", "e", "espanol", "es-ES", "ES", "es_"]) {
    if (isLanguageCode(bad)) throw new Error(`${JSON.stringify(bad)} is not a code`);
  }

  for (const [argv, why] of [
    [["--from=30", "--to=10"], "--to before --from"],
    [["a.mp4", "b.mp4", "--from=5"], "a window across several inputs"],
    [["a.mp4", "--crop=sideways"], "an unknown crop"],
    [["a.mp4", "--lang=espanol"], "a language name instead of a code"],
    [["a.mp4", "--caption=middle"], "an unknown caption position"],
    [["a.mp4", "--color=red"], "a named colour instead of hex"],
  ] as const) {
    let threw = false;
    try {
      parseArgs([...argv]);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`${why} must be rejected`);
  }

  checkFraming();

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

const checkFraming = () => {
  if (objectPositionFor("center") !== "50% 50%") throw new Error("centre crop");
  if (objectPositionFor("left") !== "0% 50%") throw new Error("left crop");
  if (objectPositionFor("right") !== "100% 50%") throw new Error("right crop");
  // Every crop must produce a position, or the style silently comes out undefined.
  for (const crop of CROPS) {
    if (!/^\d+% \d+%$/.test(objectPositionFor(crop))) {
      throw new Error(`crop ${crop} produced ${objectPositionFor(crop)}`);
    }
  }

  const last = 300;
  if (zoomScaleAt(0, last, true) !== 1) {
    throw new Error("the push must start at the source's own scale");
  }
  if (Math.abs(zoomScaleAt(last - 1, last, true) - ZOOM_TO) > 1e-9) {
    throw new Error("the push must reach ZOOM_TO exactly on the last frame");
  }
  // Monotonic, or the shot would drift backwards mid-video.
  let previous = 0;
  for (let f = 0; f < last; f++) {
    const scale = zoomScaleAt(f, last, true);
    if (scale < previous) throw new Error(`the push reversed at frame ${f}`);
    if (scale < 1) throw new Error(`scale below 1 would letterbox at frame ${f}`);
    previous = scale;
  }
  // Past the end (a still rendered beyond the range) must not keep growing.
  if (zoomScaleAt(last * 2, last, true) !== ZOOM_TO) {
    throw new Error("the push must clamp at the end rather than run away");
  }
  if (zoomScaleAt(150, last, false) !== 1) {
    throw new Error("no zoom must mean no transform at all");
  }
  // A one-frame video would divide by zero.
  if (zoomScaleAt(0, 1, true) !== 1) throw new Error("a single frame must not blow up");

  // lower must push the block to the bottom with clearance; upper to the top;
  // neither may leave the block flush against the edge (no UI clearance).
  const lower = captionLayoutFor("lower");
  if (lower.alignContent !== "flex-end" || lower.paddingBottom === "0") {
    throw new Error("lower captions must sit at the bottom, clear of the edge");
  }
  const upper = captionLayoutFor("upper");
  if (upper.alignContent !== "flex-start" || upper.paddingTop === "0") {
    throw new Error("upper captions must sit at the top, clear of the edge");
  }
  const centered = captionLayoutFor("center");
  if (centered.alignContent !== "center") {
    throw new Error("center captions must stay centred");
  }
  for (const p of CAPTION_POSITIONS) {
    const l = captionLayoutFor(p);
    if (!/^(0|\d+%)$/.test(l.paddingTop) || !/^(0|\d+%)$/.test(l.paddingBottom)) {
      throw new Error(`caption ${p} produced a bad padding`);
    }
  }
};

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
    // A bare token with no extension and no path is almost never a real input —
    // it is usually a flag value npm swallowed when `--` was left out, so the
    // script sees `es` where it expected `--lang=es`.
    const looksStripped = !input.includes("/") && !extname(input);
    const hint = looksStripped
      ? "\n(did you forget `--` after `npm run short`? without it npm eats the --flags)"
      : "";
    throw new Error(`no such file: ${input}${hint}`);
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
  const {
    inputs,
    out,
    props: renderProps,
    languageCode,
    music,
  } = parseArgs(process.argv.slice(2));

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (inputs.length === 0 || !apiKey) {
    throw new Error(
      "usage: npm run short -- <file> [more files...]\n" +
        "         [--out=x.mp4] [--from=12] [--to=1:30] [--music=song.mp3] [--hook=\"MIRA ESTO\"]\n" +
        "         [--crop=left] [--zoom] [--fit] [--lang=es] [--caption=lower] [--color=#00e5ff]\n" +
        "       (needs ASSEMBLYAI_API_KEY in .env)",
    );
  }

  const names = inputs.map(ensureInPublic);
  // Music rides over the whole video; it is not transcribed, only copied in.
  if (music !== null) {
    renderProps.musicSrc = ensureInPublic(music);
  }
  const corrections = loadCorrections();
  const clips = [];

  // Transcribed one at a time rather than in parallel: AssemblyAI rate-limits
  // per account, and a short is a handful of clips, not hundreds.
  for (const name of names) {
    console.log(`transcribing ${name}...`);
    // ponytail: the file is uploaded whole, video track included. Strip the
    // audio out with ffmpeg first if the uploads get painful.
    const result = await transcribeToCaptions({
      audio: resolve(PUBLIC_DIR, name),
      apiKey,
      languageCode,
    });
    // Printed even when detection succeeded: a wrong language is otherwise
    // only discovered by watching the finished video.
    const detected =
      result.languageConfidence === null
        ? `language ${result.languageCode}`
        : `detected ${result.languageCode} (${Math.round(result.languageConfidence * 100)}% sure)`;
    console.log(`  ${result.captions.length} words, ${detected}`);
    if (result.languageConfidence !== null && result.languageConfidence < 0.7) {
      console.log(`  low confidence — pass --lang=<code> if that is wrong`);
    }
    clips.push({
      ...clipForInput(name),
      captions: applyCorrections(result.captions, corrections),
    });
  }

  writeFileSync(CAPTIONS_OUT, JSON.stringify({ clips }, null, 2));
  console.log(`${clips.length} clip(s) -> public/captions.json`);

  const props = JSON.stringify(renderProps);
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
