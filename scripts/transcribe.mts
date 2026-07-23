// CLI shell around lib/captions.mts — argv in, file out. Logic lives in lib/.
//   npm run transcribe -- <audio-path-or-url> [out.json]
//   node scripts/transcribe.mts --check     # self-check, no API call, no key
import { writeFileSync } from "node:fs";
import type { TranscriptWord } from "assemblyai";
import { createTikTokStyleCaptions } from "@remotion/captions";
import { transcribeToCaptions, wordsToCaptions } from "./lib/captions.mts";

const DEFAULT_OUT = "public/captions.json";

const check = () => {
  const words = [
    { text: "hola", start: 0, end: 300, confidence: 0.9 },
    { text: "mundo", start: 900, end: 1200, confidence: 0.8 },
  ] as TranscriptWord[];

  const captions = wordsToCaptions(words);
  if (captions[0].text !== "hola") {
    throw new Error("first word must not be padded");
  }
  if (captions[1].text !== " mundo") {
    throw new Error("later words need a leading space");
  }

  const { pages } = createTikTokStyleCaptions({
    captions,
    combineTokensWithinMilliseconds: 200,
  });
  if (pages.length !== 2) {
    throw new Error(`expected 2 pages, got ${pages.length}`);
  }
  if (pages[1].text !== "mundo") {
    throw new Error(`page text not trimmed: ${pages[1].text}`);
  }
  console.log("ok");
};

const main = async () => {
  const [audio, out = DEFAULT_OUT] = process.argv.slice(2);
  if (audio === "--check") {
    return check();
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!audio || !apiKey) {
    throw new Error(
      "usage: npm run transcribe -- <audio> [out.json]  (needs ASSEMBLYAI_API_KEY in .env)",
    );
  }

  const captions = await transcribeToCaptions({ audio, apiKey });
  writeFileSync(out, JSON.stringify(captions, null, 2));
  console.log(`${captions.length} words -> ${out}`);
};

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
