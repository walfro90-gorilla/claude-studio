import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { trimClips, type Clip } from "../lib/silence";
import {
  CaptionedVideo,
  type CaptionedVideoProps,
} from "../components/CaptionedVideo";

const FPS = 30;
const CAPTIONS_FILE = "captions.json";

// Silence longer than this is cut out of the render. Set to null to keep the
// media whole. Raise it for deliberate, slow delivery; lower it for a tighter,
// more relentless cut.
const TRIM_SILENCE_OVER_MS: number | null = 700;
// Breathing room kept around every cut so consonants are not clipped.
const PAD_MS = 150;

// Loads the captions written by the transcribe step, drops the dead air, and
// sizes the video to what is left — so a new transcript changes the cut and
// the duration without touching this file.
const calculateMetadata: CalculateMetadataFunction<
  CaptionedVideoProps
> = async ({ props }) => {
  const res = await fetch(staticFile(CAPTIONS_FILE));
  const { clips } = (await res.json()) as { clips: Clip[] };
  const trimmed = trimClips({
    clips,
    fps: FPS,
    maxGapMs: TRIM_SILENCE_OVER_MS,
    padMs: PAD_MS,
    clipStartMs: props.clipStartMs,
    clipEndMs: props.clipEndMs,
  });

  return {
    props: {
      ...props,
      captions: trimmed.captions,
      segments: trimmed.segments,
    },
    durationInFrames: Math.max(1, trimmed.durationInFrames),
  };
};

export const Captions = () => {
  return (
    <Composition
      id="Captions"
      component={CaptionedVideo}
      durationInFrames={1}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{
        captions: [],
        segments: [],
        clipStartMs: null,
        clipEndMs: null,
        crop: "center" as const,
        zoom: false,
        caption: "lower" as const,
      }}
      calculateMetadata={calculateMetadata}
    />
  );
};
