import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import type { Caption } from "@remotion/captions";
import {
  CaptionedVideo,
  type CaptionedVideoProps,
} from "../components/CaptionedVideo";

const FPS = 30;
const CAPTIONS_FILE = "captions.json";
// Frames held after the last word so the video does not cut on the final syllable.
const TAIL_FRAMES = 15;

// Loads the captions written by scripts/transcribe.mts and sizes the video to
// them, so a new transcript changes the duration without touching this file.
const calculateMetadata: CalculateMetadataFunction<
  CaptionedVideoProps
> = async ({ props }) => {
  const res = await fetch(staticFile(CAPTIONS_FILE));
  const captions = (await res.json()) as Caption[];
  const lastMs = captions.length === 0 ? 0 : captions[captions.length - 1].endMs;

  return {
    props: { ...props, captions },
    durationInFrames: Math.ceil((lastMs / 1000) * FPS) + TAIL_FRAMES,
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
      defaultProps={{ captions: [], audioSrc: null }}
      calculateMetadata={calculateMetadata}
    />
  );
};
