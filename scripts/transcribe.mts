// CLI shell around lib/captions.mts — argv in, file out. Logic lives in lib/.
//   npm run transcribe -- <audio-path-or-url> [out.json]
//   node scripts/transcribe.mts --check     # self-check, no API call, no key
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import type { TranscriptWord } from "assemblyai";
import { createTikTokStyleCaptions } from "@remotion/captions";
import {
  isLanguageCode,
  transcribeToCaptions,
  wordsToCaptions,
} from "./lib/captions.mts";
import { clipForInput } from "./lib/short.mts";

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
  const args = process.argv.slice(2);
  if (args[0] === "--check") {
    return check();
  }
  const lang = args.find((a) => a.startsWith("--lang="));
  const [audio, out = DEFAULT_OUT] = args.filter((a) => !a.startsWith("--"));

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!audio || !apiKey) {
    throw new Error(
      "usage: npm run transcribe -- <audio> [out.json] [--lang=es]\n" +
        "       (needs ASSEMBLYAI_API_KEY in .env)",
    );
  }
  const languageCode = lang === undefined ? null : lang.slice("--lang=".length);
  if (languageCode !== null && !isLanguageCode(languageCode)) {
    throw new Error(`bad --lang: ${languageCode} (use a code like es, en, en_us)`);
  }

  const result = await transcribeToCaptions({ audio, apiKey, languageCode });
  // Same one-clip-per-entry shape the composition reads; `npm run short`
  // writes several entries into the same file.
  const clip = { ...clipForInput(basename(audio)), captions: result.captions };
  writeFileSync(out, JSON.stringify({ clips: [clip] }, null, 2));
  const detected =
    result.languageConfidence === null
      ? `language ${result.languageCode}`
      : `detected ${result.languageCode} (${Math.round(result.languageConfidence * 100)}% sure)`;
  console.log(`${result.captions.length} words, ${detected} -> ${out}`);
};

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
