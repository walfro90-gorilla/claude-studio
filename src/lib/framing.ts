// How the footage sits inside the 9:16 frame. Pure so the CLI can validate a
// flag without importing anything that touches the DOM.

/** Which part of a wider source survives the crop. */
export const CROPS = ["center", "left", "right", "top", "bottom"] as const;
export type Crop = (typeof CROPS)[number];

export const isCrop = (value: string): value is Crop =>
  (CROPS as readonly string[]).includes(value);

/** Where the caption block sits vertically in the 9:16 frame. */
export const CAPTION_POSITIONS = ["lower", "center", "upper"] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];

export const isCaptionPosition = (value: string): value is CaptionPosition =>
  (CAPTION_POSITIONS as readonly string[]).includes(value);

/**
 * Vertical placement of the caption block. The block is a flex ROW that wraps,
 * so its lines run down the CROSS axis — `alignContent`, not `justifyContent`,
 * moves them vertically (that one stays centred for horizontal centring).
 * Padding is a fraction of frame height, keeping the block clear of the
 * platform UI. `lower` is the short-form default: the app's buttons and
 * description sit in the bottom ~8%, so the block ends above that. That
 * platform-chrome margin only applies to the vertical 9:16 short; a
 * `--landscape` render has no such overlay, so it gets a much thinner edge
 * margin and the block reads as flush against the bottom of the screen.
 */
export const captionLayoutFor = (
  position: CaptionPosition,
  landscape = false,
): { alignContent: string; paddingTop: string; paddingBottom: string } => {
  const edge = landscape ? "4%" : "18%";
  return {
    lower: { alignContent: "flex-end", paddingTop: "0", paddingBottom: edge },
    center: { alignContent: "center", paddingTop: "0", paddingBottom: "0" },
    upper: { alignContent: "flex-start", paddingTop: edge, paddingBottom: "0" },
  }[position];
};

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

/** The active-word colour when none is given. */
export const DEFAULT_COLOR = "#fde047";

/**
 * Hex only (`#f00`, `#ff0000`, `#ff0000aa`). Named CSS colours would need the
 * browser's full list to validate; hex covers brand colours and fails a typo
 * before it costs a render.
 */
export const isHexColor = (value: string): boolean =>
  /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);

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
