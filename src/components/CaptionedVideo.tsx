import { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
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
  audioSrc: string | null;
};

export const CaptionedVideo: React.FC<CaptionedVideoProps> = ({
  captions,
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
    <AbsoluteFill className="items-center justify-center bg-black">
      {audioSrc === null ? null : <Audio src={staticFile(audioSrc)} />}
      {page === undefined ? null : (
        <div className="flex flex-wrap justify-center gap-x-6 px-20 text-center">
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
        </div>
      )}
    </AbsoluteFill>
  );
};
