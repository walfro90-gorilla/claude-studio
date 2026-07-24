// Turns word timestamps into the stretches worth keeping, dropping the dead
// air between them. Pure and dependency-free on purpose: it runs inside the
// bundled composition and inside the Node self-check.
import type { Caption } from "@remotion/captions";

/** A transcribed source file, as written into public/captions.json. */
export type Clip = {
  /** Filename inside public/. */
  src: string;
  /** Video plays behind the captions; audio plays over black. */
  isVideo: boolean;
  captions: Caption[];
};

/** One kept stretch of media, already expressed in frames of the output. */
export type Segment = {
  /** Which source file this stretch is read from. */
  src: string;
  isVideo: boolean;
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
  /** Manual in-point into the source, in ms. `null` starts at the beginning. */
  clipStartMs?: number | null;
  /** Manual out-point into the source, in ms. `null` runs to the end. */
  clipEndMs?: number | null;
  /** Which file the segments read from. */
  src?: string;
  isVideo?: boolean;
  /** Frames already used by earlier clips, so captions land on the joint timeline. */
  frameOffset?: number;
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
  captions: allCaptions,
  fps,
  maxGapMs,
  padMs,
  clipStartMs = null,
  clipEndMs = null,
  src = "",
  isVideo = false,
  frameOffset: startFrame = 0,
}: TrimSilenceInput): TrimSilenceOutput => {
  // Only words spoken WHOLE inside the window survive it. Keeping a word that
  // straddles an edge would clip its audio mid-syllable and, at the in-point,
  // shift its caption to a negative time — it would never be drawn.
  const from = clipStartMs ?? 0;
  const to = clipEndMs ?? Infinity;
  const captions = allCaptions.filter(
    (c) => c.startMs >= from && c.endMs <= to,
  );

  if (captions.length === 0) {
    return { segments: [], captions: [], durationInFrames: 0 };
  }

  const msToFrames = (ms: number) => Math.round((ms / 1000) * fps);
  const lastMs = captions[captions.length - 1].endMs;
  const kept = (
    maxGapMs === null
      ? [{ startMs: from, endMs: clipEndMs ?? lastMs + padMs }]
      : pad(spans(captions, maxGapMs), padMs)
  ).map((span) => ({
    startMs: Math.max(from, span.startMs),
    endMs: Math.min(to, span.endMs),
  }));

  const segments: Segment[] = [];
  const shifted: Caption[] = [];
  // Starts where the earlier clips left off, so captions land on the joint
  // timeline rather than each clip's own.
  let frameOffset = startFrame;

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

    segments.push({ src, isVideo, trimBefore, trimAfter, durationInFrames });
    frameOffset += durationInFrames;
  }

  // durationInFrames counts only what this call added, so a caller accumulating
  // across clips can add the results up without subtracting the offset back out.
  return {
    segments,
    captions: shifted,
    durationInFrames: frameOffset - startFrame,
  };
};

export type TrimClipsInput = Omit<
  TrimSilenceInput,
  "captions" | "src" | "isVideo" | "frameOffset"
> & { clips: Clip[] };

/**
 * Runs the trim over several clips and lays them end to end. Each clip keeps
 * its own source timestamps; only the output timeline is shared.
 */
export const trimClips = ({
  clips,
  ...options
}: TrimClipsInput): TrimSilenceOutput => {
  const segments: Segment[] = [];
  const captions: Caption[] = [];
  let frameOffset = 0;

  for (const clip of clips) {
    const cut = trimSilence({
      ...options,
      captions: clip.captions,
      src: clip.src,
      isVideo: clip.isVideo,
      frameOffset,
    });
    segments.push(...cut.segments);
    captions.push(...cut.captions);
    frameOffset += cut.durationInFrames;
  }

  return { segments, captions, durationInFrames: frameOffset };
};
