// Input routing for the one-command short pipeline. Pure: takes names,
// returns what the composition should be handed.
import { extname } from "node:path";
// Crossing into src/ is safe here: framing.ts is pure and touches no DOM.
import {
  CAPTION_POSITIONS,
  CROPS,
  DEFAULT_COLOR,
  isCaptionPosition,
  isCrop,
  isHexColor,
  type CaptionPosition,
  type Crop,
} from "../../src/lib/framing.ts";
import { isLanguageCode } from "./captions.mts";

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"];

export const isVideo = (file: string): boolean =>
  VIDEO_EXTENSIONS.includes(extname(file).toLowerCase());

/** Video plays behind the captions and brings its own audio; anything else plays over black. */
export const clipForInput = (publicName: string) => ({
  src: publicName,
  isVideo: isVideo(publicName),
});

/** `90`, `1:30` and `1:02:03` all mean the same thing to a person. */
export const parseTime = (value: string): number => {
  const parts = value.split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || !/^\d*\.?\d+$/.test(p))) {
    throw new Error(`bad time: ${value} (use seconds, mm:ss or hh:mm:ss)`);
  }
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return Math.round(seconds * 1000);
};

export type RenderProps = {
  clipStartMs: number | null;
  clipEndMs: number | null;
  crop: Crop;
  zoom: boolean;
  caption: CaptionPosition;
  color: string;
};

export type ParsedArgs = {
  /** Input files, in the order they should play. */
  inputs: string[];
  out: string;
  /** Passed straight through to the composition as --props. */
  props: RenderProps;
  /** Pinned transcription language. `null` asks AssemblyAI to detect it. */
  languageCode: string | null;
};

const DEFAULT_OUT = "out/short.mp4";

/**
 * Every positional argument is an input; the output is named with --out.
 * Guessing which trailing path was meant as the destination is exactly the
 * kind of magic that silently transcribes the file you meant to write.
 */
export const parseArgs = (argv: string[]): ParsedArgs => {
  const inputs: string[] = [];
  const props: RenderProps = {
    clipStartMs: null,
    clipEndMs: null,
    crop: "center",
    zoom: false,
    caption: "lower",
    color: DEFAULT_COLOR,
  };
  let out = DEFAULT_OUT;
  let languageCode: string | null = null;

  for (const arg of argv) {
    if (arg === "--zoom") {
      props.zoom = true;
      continue;
    }
    const match = /^--(from|to|out|crop|lang|caption|color)=(.+)$/.exec(arg);
    if (match === null) {
      inputs.push(arg);
      continue;
    }
    const [, flag, value] = match;
    if (flag === "out") {
      out = value;
    } else if (flag === "color") {
      if (!isHexColor(value)) {
        throw new Error(`bad --color: ${value} (use a hex code like #00e5ff)`);
      }
      props.color = value;
    } else if (flag === "lang") {
      if (!isLanguageCode(value)) {
        throw new Error(`bad --lang: ${value} (use a code like es, en, en_us)`);
      }
      languageCode = value;
    } else if (flag === "crop") {
      if (!isCrop(value)) {
        throw new Error(`bad --crop: ${value} (use ${CROPS.join(", ")})`);
      }
      props.crop = value;
    } else if (flag === "caption") {
      if (!isCaptionPosition(value)) {
        throw new Error(`bad --caption: ${value} (use ${CAPTION_POSITIONS.join(", ")})`);
      }
      props.caption = value;
    } else if (flag === "from") {
      props.clipStartMs = parseTime(value);
    } else {
      props.clipEndMs = parseTime(value);
    }
  }

  if (
    props.clipStartMs !== null &&
    props.clipEndMs !== null &&
    props.clipEndMs <= props.clipStartMs
  ) {
    throw new Error("--to must come after --from");
  }
  // A window is a window into ONE recording; across several it would silently
  // mean something different from what anyone expects.
  if (
    inputs.length > 1 &&
    (props.clipStartMs !== null || props.clipEndMs !== null)
  ) {
    throw new Error("--from/--to work on a single input; trim the clips first");
  }
  return { inputs, out, props, languageCode };
};
