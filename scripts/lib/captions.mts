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
  languageCode?: string;
};

export const transcribeToCaptions = async ({
  audio,
  apiKey,
  languageCode,
}: TranscribeInput): Promise<Caption[]> => {
  const client = new AssemblyAI({ apiKey });
  const transcript = await client.transcripts.transcribe({
    audio,
    language_code: languageCode,
  });
  if (transcript.status === "error") {
    throw new Error(transcript.error ?? "AssemblyAI returned an error");
  }
  return wordsToCaptions(transcript.words ?? []);
};
