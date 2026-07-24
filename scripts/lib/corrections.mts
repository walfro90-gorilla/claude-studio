// Reads the optional string-map config files. Separate from the pure libs so
// they stay fs-free; this is the thin shell around them.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const CORRECTIONS_PATH = resolve("corrections.json");
export const OVERLAYS_PATH = resolve("overlays.json");

/** `{}` when absent; a clear error when present but not an object of strings. */
const loadStringMap = (
  path: string,
  label: string,
): Record<string, string> => {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((v) => typeof v !== "string")
  ) {
    throw new Error(`${label} must be an object of string values`);
  }
  return parsed as Record<string, string>;
};

/** `{"misheard": "correct"}` applied to the transcript. */
export const loadCorrections = (path = CORRECTIONS_PATH) =>
  loadStringMap(path, "corrections.json");

/** `{"keyword": "image.png"}` — shown when the keyword is spoken. */
export const loadOverlays = (path = OVERLAYS_PATH) =>
  loadStringMap(path, "overlays.json");
