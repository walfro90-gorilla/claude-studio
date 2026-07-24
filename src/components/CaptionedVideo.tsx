import { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  Series,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { loadFont } from "@remotion/google-fonts/Montserrat";
import type { Segment } from "../lib/silence";
import {
  captionLayoutFor,
  objectPositionFor,
  zoomScaleAt,
  type CaptionPosition,
  type Crop,
} from "../lib/framing";
import { DEFAULT_DUCK, musicVolumeAt } from "../lib/ducking";
import { overlaysFromCaptions } from "../lib/overlays";

// Pinned so the render does not depend on whatever font the rendering machine
// happens to have. Remotion blocks the render until the font is ready, so the
// first frame never draws in a fallback face.
const { fontFamily } = loadFont("normal", {
  weights: ["900"],
  subsets: ["latin"],
});

// Acts as a minimum page duration: a page only breaks on a word once the page
// already spans this long. Lower = shorter pages, faster cuts.
export const COMBINE_TOKENS_WITHIN_MS = 800;

export type CaptionedVideoProps = {
  /** Already shifted onto the trimmed timeline by calculateMetadata. */
  captions: Caption[];
  /**
   * The stretches of media that survived the cut, in play order. Each one
   * names its own source, so a run can span several clips.
   */
  segments: Segment[];
  /** Manual in/out points into the source, in ms. Consumed by calculateMetadata. */
  clipStartMs: number | null;
  clipEndMs: number | null;
  /** Which part of a wider source survives the crop to 9:16. */
  crop: Crop;
  /** Slow Ken Burns push across the whole video. */
  zoom: boolean;
  /** Where the caption block sits vertically. */
  caption: CaptionPosition;
  /** Colour of the currently-spoken word. Any CSS colour. */
  color: string;
  /** contain (fit the whole frame with bars) instead of cover (crop to 9:16). */
  fit: boolean;
  /** Background music filename in public/, ducked under speech. null for none. */
  musicSrc: string | null;
  /** Hook-card text held before the video; null for none. */
  hook: string | null;
  /** How many frames the hook card holds. 0 when there is no hook. */
  hookFrames: number;
  /** @handle watermark shown over the whole video; null for none. */
  handle: string | null;
  /** Keyword -> image filename in public/, shown while the word is spoken. */
  overlays: Record<string, string>;
};

// The video, captions, music and keyword overlays. Split out so it can live
// inside a Sequence that starts after the hook card, which rebases
// useCurrentFrame to 0 — everything then times against the content, not the hook.
type ContentProps = Omit<
  CaptionedVideoProps,
  "hook" | "hookFrames" | "handle"
> & {
  /** The content's own length, for the zoom span (excludes the hook). */
  durationInFrames: number;
};

const CaptionedContent: React.FC<ContentProps> = ({
  captions,
  segments,
  crop,
  zoom,
  caption,
  color,
  fit,
  musicSrc,
  overlays,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  // Keyword overlays resolved from the word timings, once per caption set.
  const overlayInstances = useMemo(
    () => overlaysFromCaptions(captions, overlays),
    [captions, overlays],
  );

  // Computed here, where the frame is ABSOLUTE within the content. Inside a
  // Series.Sequence it restarts from zero, so the push would snap back on
  // every silence cut.
  const videoStyle = {
    width: "100%",
    height: "100%",
    // contain fits the whole frame with bars, for screen recordings whose
    // edges matter; cover crops to 9:16. crop only bites under cover.
    objectFit: fit ? "contain" : "cover",
    objectPosition: fit ? "50% 50%" : objectPositionFor(crop),
    transform: `scale(${zoomScaleAt(frame, durationInFrames, zoom)})`,
  } as const;

  const { pages } = useMemo(
    () =>
      createTikTokStyleCaptions({
        captions,
        combineTokensWithinMilliseconds: COMBINE_TOKENS_WITHIN_MS,
      }),
    [captions],
  );

  const page = pages.find(
    (p) => ms >= p.startMs && ms < p.startMs + p.durationMs,
  );

  // Speech lives where the words are, on the already-trimmed timeline.
  const speech = useMemo(
    () => captions.map((c) => ({ startMs: c.startMs, endMs: c.endMs })),
    [captions],
  );

  return (
    <AbsoluteFill className="bg-black">
      {/* One continuous layer over the whole video, looped to cover any length,
          ducked under speech by the word timings — nothing analyses the audio. */}
      {musicSrc === null ? null : (
        <Audio
          src={staticFile(musicSrc)}
          loop
          volume={(f) => musicVolumeAt((f / fps) * 1000, speech, DEFAULT_DUCK)}
        />
      )}
      {/* One sequence per surviving stretch, played back to back. trimBefore
          and trimAfter point into the SOURCE media; the silence between them
          never reaches the output. */}
      <Series>
        {segments.map((segment, i) => (
          <Series.Sequence
            key={`${segment.src}-${segment.trimBefore}-${i}`}
            durationInFrames={segment.durationInFrames}
          >
            {segment.isVideo ? (
              <OffthreadVideo
                src={staticFile(segment.src)}
                trimBefore={segment.trimBefore}
                trimAfter={segment.trimAfter}
                // objectFit: cover crops horizontal footage to 9:16 rather than
                // letterboxing it; `crop` picks which part survives.
                style={videoStyle}
              />
            ) : (
              <Audio
                src={staticFile(segment.src)}
                trimBefore={segment.trimBefore}
                trimAfter={segment.trimAfter}
              />
            )}
          </Series.Sequence>
        ))}
      </Series>
      {/* Keyword overlays: above the video, below the captions, in the upper
          third so they clear the lower-third caption block. */}
      {overlayInstances.map((o, i) => {
        const from = Math.round((o.fromMs / 1000) * fps);
        const dur = Math.max(1, Math.round((o.toMs / 1000) * fps) - from);
        return (
          <Sequence key={`${o.src}-${from}-${i}`} from={from} durationInFrames={dur}>
            <OverlayImage src={o.src} durationInFrames={dur} />
          </Sequence>
        );
      })}
      {/* Its own layer: the video above is positioned, so a static caption
          element would be painted underneath it and vanish. flex-row because
          AbsoluteFill defaults to a column, which stacks every word on its
          own line. justifyContent/padding place the block vertically. */}
      {page === undefined ? null : (
        <AbsoluteFill
          className="flex-row flex-wrap items-center justify-center gap-x-6 px-20 text-center"
          style={captionLayoutFor(caption)}
        >
          {page.tokens.map((token, i) => (
            <span
              key={`${token.fromMs}-${i}`}
              style={{
                fontFamily,
                fontSize: 96,
                fontWeight: 900,
                textTransform: "uppercase",
                // The active word takes the accent colour; the rest stay white.
                color: ms >= token.fromMs && ms < token.toMs ? color : "white",
                // ponytail: stroke instead of a shadow — stays legible on any footage.
                WebkitTextStroke: "10px black",
                paintOrder: "stroke",
              }}
            >
              {token.text}
            </span>
          ))}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// A keyword overlay: an image in the upper third, fading in and out so it
// never pops. Its own component so it can call the frame hook for the fade.
const FADE_FRAMES = 6;
const OverlayImage: React.FC<{ src: string; durationInFrames: number }> = ({
  src,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, FADE_FRAMES, durationInFrames - FADE_FRAMES, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill className="items-center justify-center" style={{ opacity }}>
      <Img
        src={staticFile(src)}
        style={{
          position: "absolute",
          top: "18%",
          width: "50%",
          maxHeight: "35%",
          objectFit: "contain",
        }}
      />
    </AbsoluteFill>
  );
};

// The @handle watermark: small, dim, top-centre, over the whole video.
const HandleTag: React.FC<{ handle: string }> = ({ handle }) => (
  <AbsoluteFill className="items-center" style={{ pointerEvents: "none" }}>
    <div
      style={{
        position: "absolute",
        top: "4%",
        fontFamily,
        fontSize: 40,
        fontWeight: 900,
        color: "white",
        opacity: 0.85,
        WebkitTextStroke: "5px black",
        paintOrder: "stroke",
      }}
    >
      {handle}
    </div>
  </AbsoluteFill>
);

// A full-screen title card on black, shown for hookFrames before the video.
const HookCard: React.FC<{ text: string; color: string }> = ({
  text,
  color,
}) => (
  <AbsoluteFill className="items-center justify-center bg-black px-24 text-center">
    <div
      style={{
        fontFamily,
        fontSize: 128,
        fontWeight: 900,
        lineHeight: 1.05,
        textTransform: "uppercase",
        color,
        WebkitTextStroke: "12px black",
        paintOrder: "stroke",
      }}
    >
      {text}
    </div>
  </AbsoluteFill>
);

export const CaptionedVideo: React.FC<CaptionedVideoProps> = ({
  hook,
  hookFrames,
  handle,
  ...content
}) => {
  const { durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill className="bg-black">
      {hook === null ? null : (
        <Sequence durationInFrames={hookFrames}>
          <HookCard text={hook} color={content.color} />
        </Sequence>
      )}
      {/* Everything else starts after the hook. from={hookFrames} rebases the
          children's frame to 0, so captions and music stay content-relative. */}
      <Sequence from={hookFrames}>
        <CaptionedContent
          {...content}
          durationInFrames={durationInFrames - hookFrames}
        />
      </Sequence>
      {/* Watermark spans the whole video, hook included — it is branding. */}
      {handle === null ? null : <HandleTag handle={handle} />}
    </AbsoluteFill>
  );
};
