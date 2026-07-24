// Caption domain logic. No argv, no console, no process.exit — so the same
// functions back the CLI today and an API route when this becomes a service.
import { AssemblyAI, type TranscriptWord } from "assemblyai";
import type { Caption } from "@remotion/captions";

// Remotion pages captions on a LEADING SPACE in `text`; AssemblyAI words have none.
// Without it every word concatenates into one unbreakable line.
export const wordsToCaptions = (words: TranscriptWord[]): Caption[] =>
  words.map((w, i) => ({
    text: i === 0 ? w.text : ` ${w.text}`,
    startMs: w.start,
    endMs: w.end,
    timestampMs: (w.start + w.end) / 2,
    confidence: w.confidence,
  }));

export type TranscribeInput = {
  /** Local file path, public URL, readable stream or buffer. */
  audio: string;
  apiKey: string;
  /** Omitted = auto-detect. Pin it when the audio language is known. */
  languageCode?: string | null;
};

export type TranscribeResult = {
  captions: Caption[];
  /** What the audio was taken to be — the pinned code, or what detection chose. */
  languageCode: string | null;
  /** Detection's own confidence, 0-1. `null` when the language was pinned. */
  languageConfidence: number | null;
};

/**
 * A language code is only accepted here as a shape (`es`, `en_us`); the real
 * list lives at AssemblyAI and duplicating a hundred entries would go stale.
 * This catches a typo before it costs an API call.
 */
export const isLanguageCode = (value: string): boolean =>
  /^[a-z]{2,3}(_[a-z]{2,6})?$/.test(value);

export const transcribeToCaptions = async ({
  audio,
  apiKey,
  languageCode,
}: TranscribeInput): Promise<TranscribeResult> => {
  const client = new AssemblyAI({ apiKey });
  const transcript = await client.transcripts.transcribe({
    audio,
    // Asking for detection explicitly, rather than leaving both unset, is what
    // makes AssemblyAI report back which language it settled on.
    ...(languageCode
      ? { language_code: languageCode }
      : { language_detection: true }),
  });
  if (transcript.status === "error") {
    throw new Error(transcript.error ?? "AssemblyAI returned an error");
  }
  return {
    captions: wordsToCaptions(transcript.words ?? []),
    languageCode: languageCode ?? transcript.language_code ?? null,
    languageConfidence: languageCode ? null : (transcript.language_confidence ?? null),
  };
};
