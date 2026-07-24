// Turns "show this image when this word is spoken" into concrete timed overlays,
// using the caption word timings. Pure so the CLI can test it without a browser.
import type { Caption } from "@remotion/captions";

export type OverlayInstance = {
  /** Image filename in public/. */
  src: string;
  /** When it appears and disappears, on the caption (output) timeline. */
  fromMs: number;
  toMs: number;
};

/** A short word would flash by; every overlay stays up at least this long. */
export const OVERLAY_HOLD_MS = 1300;

/**
 * One instance per caption word that matches a key in `map` (whole word,
 * case-insensitive, punctuation ignored). It appears with the word and holds
 * until the word ends or OVERLAY_HOLD_MS passes, whichever is later.
 */
export const overlaysFromCaptions = (
  captions: Caption[],
  map: Record<string, string>,
  holdMs = OVERLAY_HOLD_MS,
): OverlayInstance[] => {
  const lower = new Map(
    Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]),
  );
  if (lower.size === 0) return [];

  const out: OverlayInstance[] = [];
  for (const caption of captions) {
    const core = caption.text.trim().match(/^[\p{L}\p{N}']+/u)?.[0];
    if (core === undefined) continue;
    const src = lower.get(core.toLowerCase());
    if (src === undefined) continue;
    out.push({
      src,
      fromMs: caption.startMs,
      toMs: Math.max(caption.endMs, caption.startMs + holdMs),
    });
  }
  return out;
};
