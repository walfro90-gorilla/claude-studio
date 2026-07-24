// Background-music volume that ducks under speech. Pure so the CLI can test the
// curve without a browser. The speech intervals come straight from the caption
// word timings, so nothing analyses the audio.

export type Interval = { startMs: number; endMs: number };

export type DuckOptions = {
  /** Volume during silence, 0-1. */
  full: number;
  /** Volume under speech, 0-1. */
  duck: number;
  /** Ramp on each side of a word, so the level glides instead of clicking. */
  rampMs: number;
};

export const DEFAULT_DUCK: DuckOptions = { full: 0.55, duck: 0.12, rampMs: 200 };

/**
 * 0 where there is no speech, 1 inside a word, a linear ramp across `rampMs` on
 * each edge. The max across intervals wins, so overlapping ramps never lift the
 * duck back up between two close words.
 */
export const duckFactorAt = (
  ms: number,
  intervals: Interval[],
  rampMs: number,
): number => {
  let factor = 0;
  for (const { startMs, endMs } of intervals) {
    let local = 0;
    if (ms >= startMs && ms <= endMs) {
      local = 1;
    } else if (rampMs > 0 && ms >= startMs - rampMs && ms < startMs) {
      local = (ms - (startMs - rampMs)) / rampMs;
    } else if (rampMs > 0 && ms > endMs && ms <= endMs + rampMs) {
      local = 1 - (ms - endMs) / rampMs;
    }
    if (local > factor) factor = local;
    if (factor === 1) break;
  }
  return factor;
};

/** Full volume in silence, ducked under speech, ramped between. */
export const musicVolumeAt = (
  ms: number,
  intervals: Interval[],
  { full, duck, rampMs }: DuckOptions,
): number => full - duckFactorAt(ms, intervals, rampMs) * (full - duck);
