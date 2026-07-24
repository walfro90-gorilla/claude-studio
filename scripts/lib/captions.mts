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

/**
 * Fixes words the transcriber reliably mishears — brand and product names most
 * of all ("cloud" for Claude). The map is misheard→correct, matched
 * case-insensitively on the whole word; the replacement keeps the original's
 * leading space, timing, and capitalisation shape (ALL CAPS in, ALL CAPS out,
 * since the captions render uppercase).
 *
 * ponytail: whole single words only. A one→many fix ("mister all"→Mistral)
 * spans two timestamped words and is left for when it actually bites — a
 * multi-word matcher over the token stream, not a bigger map.
 */
export const applyCorrections = (
  captions: Caption[],
  corrections: Record<string, string>,
): Caption[] => {
  const lower = new Map(
    Object.entries(corrections).map(([k, v]) => [k.toLowerCase(), v]),
  );
  if (lower.size === 0) return captions;

  return captions.map((caption) => {
    const lead = caption.text.startsWith(" ") ? " " : "";
    const word = caption.text.slice(lead.length);
    // Keep punctuation attached to the word ("cloud." stays "Claude.").
    const match = /^([\p{L}\p{N}']+)(.*)$/u.exec(word);
    if (match === null) return caption;
    const [, core, tail] = match;
    const fix = lower.get(core.toLowerCase());
    if (fix === undefined) return caption;
    const cased = core === core.toUpperCase() ? fix.toUpperCase() : fix;
    return { ...caption, text: `${lead}${cased}${tail}` };
  });
};

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
