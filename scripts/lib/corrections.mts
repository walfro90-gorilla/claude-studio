// Reads the optional transcript-correction map. Separate from captions.mts so
// that file stays pure (no fs); this is the thin shell around it.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const CORRECTIONS_PATH = resolve("corrections.json");

/** `{}` when the file is absent; a clear error when it is present but broken. */
export const loadCorrections = (
  path = CORRECTIONS_PATH,
): Record<string, string> => {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`corrections.json is not valid JSON`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((v) => typeof v !== "string")
  ) {
    throw new Error(`corrections.json must be an object of "misheard": "correct" strings`);
  }
  return parsed as Record<string, string>;
};
