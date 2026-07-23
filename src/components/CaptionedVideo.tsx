import { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { loadFont } from "@remotion/google-fonts/Montserrat";

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
  captions: Caption[];
  /** Filename inside public/. Its own audio track plays; must cover the whole video. */
  videoSrc: string | null;
  /** Filename inside public/. Use when the footage has no usable audio of its own. */
  audioSrc: string | null;
};

export const CaptionedVideo: React.FC<CaptionedVideoProps> = ({
  captions,
  videoSrc,
  audioSrc,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

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
      {videoSrc === null ? null : (
        <AbsoluteFill>
          <OffthreadVideo
            src={staticFile(videoSrc)}
            // Crops horizontal footage to 9:16 around its centre instead of
            // letterboxing it. Reframe in the editor if the subject is off-centre.
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </AbsoluteFill>
      )}
      {audioSrc === null ? null : <Audio src={staticFile(audioSrc)} />}
      {/* Its own layer: the video above is positioned, so a static caption
          element would be painted underneath it and vanish. flex-row because
          AbsoluteFill defaults to a column, which stacks every word on its
          own line. */}
      {page === undefined ? null : (
        <AbsoluteFill className="flex-row flex-wrap content-center items-center justify-center gap-x-6 px-20 text-center">
          {page.tokens.map((token, i) => (
            <span
              key={`${token.fromMs}-${i}`}
              className={
                ms >= token.fromMs && ms < token.toMs
                  ? "text-yellow-300"
                  : "text-white"
              }
              style={{
                fontFamily,
                fontSize: 96,
                fontWeight: 900,
                textTransform: "uppercase",
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
