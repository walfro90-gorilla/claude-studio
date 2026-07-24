import { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
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
};

export const CaptionedVideo: React.FC<CaptionedVideoProps> = ({
  captions,
  segments,
  crop,
  zoom,
  caption,
  color,
  fit,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  // Computed here, where the frame is ABSOLUTE. Inside a Series.Sequence it
  // restarts from zero, so the push would snap back on every silence cut.
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

  return (
    <AbsoluteFill className="bg-black">
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
