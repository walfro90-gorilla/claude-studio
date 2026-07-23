// One command: media file in, subtitled vertical short out.
//   npm run short -- <audio-or-video> [out.mp4]
//   node scripts/short.mts --check      # self-check, no API call, no render
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { transcribeToCaptions } from "./lib/captions.mts";
import { isVideo, propsForInput } from "./lib/short.mts";

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
  console.log("ok");
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
