// Turns word timestamps into the stretches worth keeping, dropping the dead
// air between them. Pure and dependency-free on purpose: it runs inside the
// bundled composition and inside the Node self-check.
import type { Caption } from "@remotion/captions";

/** One kept stretch of media, already expressed in frames of the output. */
export type Segment = {
  /** Frame of the SOURCE media this stretch starts at. */
  trimBefore: number;
  /** Frame of the SOURCE media this stretch ends at. */
  trimAfter: number;
  /** How many frames it occupies in the OUTPUT. */
  durationInFrames: number;
};

export type TrimSilenceInput = {
  captions: Caption[];
  fps: number;
  /** Silence longer than this is cut. `null` keeps the media untouched. */
  maxGapMs: number | null;
  /** Breathing room kept on each side of a cut, so consonants are not clipped. */
  padMs: number;
};

export type TrimSilenceOutput = {
  segments: Segment[];
  /** Captions shifted onto the shortened timeline. */
  captions: Caption[];
  durationInFrames: number;
};

const spans = (
  captions: Caption[],
  maxGapMs: number,
): { startMs: number; endMs: number }[] => {
  const out: { startMs: number; endMs: number }[] = [];
  let startMs = captions[0].startMs;
  let endMs = captions[0].endMs;

  for (let i = 1; i < captions.length; i++) {
    const caption = captions[i];
    if (caption.startMs - endMs > maxGapMs) {
      out.push({ startMs, endMs });
      startMs = caption.startMs;
    }
    endMs = caption.endMs;
  }
  out.push({ startMs, endMs });
  return out;
};

// Never eat more than half a gap on either side, so two neighbouring segments
// cannot pad into each other and replay the same moment twice.
const pad = (
  raw: { startMs: number; endMs: number }[],
  padMs: number,
): { startMs: number; endMs: number }[] =>
  raw.map((span, i) => {
    const gapBefore = span.startMs - (i === 0 ? 0 : raw[i - 1].endMs);
    const gapAfter =
      i === raw.length - 1 ? padMs * 2 : raw[i + 1].startMs - span.endMs;
    return {
      startMs: Math.max(0, span.startMs - Math.min(padMs, gapBefore / 2)),
      endMs: span.endMs + Math.min(padMs, gapAfter / 2),
    };
  });

export const trimSilence = ({
  captions,
  fps,
  maxGapMs,
  padMs,
}: TrimSilenceInput): TrimSilenceOutput => {
  if (captions.length === 0) {
    return { segments: [], captions: [], durationInFrames: 0 };
  }

  const msToFrames = (ms: number) => Math.round((ms / 1000) * fps);
  const lastMs = captions[captions.length - 1].endMs;
  const kept =
    maxGapMs === null
      ? [{ startMs: 0, endMs: lastMs + padMs }]
      : pad(spans(captions, maxGapMs), padMs);

  const segments: Segment[] = [];
  const shifted: Caption[] = [];
  let frameOffset = 0;

  for (const span of kept) {
    const trimBefore = msToFrames(span.startMs);
    const trimAfter = msToFrames(span.endMs);
    const durationInFrames = Math.max(1, trimAfter - trimBefore);

    // Shift by the FRAME offset, not the millisecond one: rounding each
    // segment to whole frames otherwise drifts the captions a little further
    // out of sync with every cut.
    const shiftMs = (frameOffset / fps) * 1000 - span.startMs;
    for (const caption of captions) {
      if (caption.startMs < span.startMs || caption.startMs >= span.endMs) {
        continue;
      }
      shifted.push({
        ...caption,
        startMs: caption.startMs + shiftMs,
        endMs: caption.endMs + shiftMs,
        timestampMs:
          caption.timestampMs === null ? null : caption.timestampMs + shiftMs,
      });
    }

    segments.push({ trimBefore, trimAfter, durationInFrames });
    frameOffset += durationInFrames;
  }

  return { segments, captions: shifted, durationInFrames: frameOffset };
};
