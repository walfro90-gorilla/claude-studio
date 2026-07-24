// How the footage sits inside the 9:16 frame. Pure so the CLI can validate a
// flag without importing anything that touches the DOM.

/** Which part of a wider source survives the crop. */
export const CROPS = ["center", "left", "right", "top", "bottom"] as const;
export type Crop = (typeof CROPS)[number];

export const isCrop = (value: string): value is Crop =>
  (CROPS as readonly string[]).includes(value);

/**
 * `objectFit: cover` keeps the centre by default; this moves the surviving
 * window for footage whose subject is not centred.
 */
export const objectPositionFor = (crop: Crop): string =>
  ({
    center: "50% 50%",
    left: "0% 50%",
    right: "100% 50%",
    top: "50% 0%",
    bottom: "50% 100%",
  })[crop];

/** How much a Ken Burns push grows the frame over the whole video. */
export const ZOOM_TO = 1.12;

/**
 * A slow push, so a locked-off shot does not read as a still. Driven by the
 * ABSOLUTE frame: inside a Series.Sequence the frame restarts, which would
 * make the zoom jump back on every silence cut.
 */
export const zoomScaleAt = (
  frame: number,
  durationInFrames: number,
  enabled: boolean,
): number => {
  if (!enabled || durationInFrames <= 1) {
    return 1;
  }
  const progress = Math.min(1, Math.max(0, frame / (durationInFrames - 1)));
  return 1 + (ZOOM_TO - 1) * progress;
};
