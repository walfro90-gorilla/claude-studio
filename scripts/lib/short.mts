// Input routing for the one-command short pipeline. Pure: takes names,
// returns what the composition should be handed.
import { extname } from "node:path";

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

export type ClipWindow = { clipStartMs: number | null; clipEndMs: number | null };

export type ParsedArgs = {
  /** Input files, in the order they should play. */
  inputs: string[];
  out: string;
  window: ClipWindow;
};

const DEFAULT_OUT = "out/short.mp4";

/**
 * Every positional argument is an input; the output is named with --out.
 * Guessing which trailing path was meant as the destination is exactly the
 * kind of magic that silently transcribes the file you meant to write.
 */
export const parseArgs = (argv: string[]): ParsedArgs => {
  const inputs: string[] = [];
  const window: ClipWindow = { clipStartMs: null, clipEndMs: null };
  let out = DEFAULT_OUT;

  for (const arg of argv) {
    const match = /^--(from|to|out)=(.+)$/.exec(arg);
    if (match === null) {
      inputs.push(arg);
      continue;
    }
    if (match[1] === "out") {
      out = match[2];
      continue;
    }
    const ms = parseTime(match[2]);
    if (match[1] === "from") {
      window.clipStartMs = ms;
    } else {
      window.clipEndMs = ms;
    }
  }

  if (
    window.clipStartMs !== null &&
    window.clipEndMs !== null &&
    window.clipEndMs <= window.clipStartMs
  ) {
    throw new Error("--to must come after --from");
  }
  // A window is a window into ONE recording; across several it would silently
  // mean something different from what anyone expects.
  if (
    inputs.length > 1 &&
    (window.clipStartMs !== null || window.clipEndMs !== null)
  ) {
    throw new Error("--from/--to work on a single input; trim the clips first");
  }
  return { inputs, out, window };
};
