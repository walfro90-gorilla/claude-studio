// Input routing for the one-command short pipeline. Pure: takes names,
// returns what the composition should be handed.
import { extname } from "node:path";

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"];

export const isVideo = (file: string): boolean =>
  VIDEO_EXTENSIONS.includes(extname(file).toLowerCase());

export type ShortProps = {
  videoSrc: string | null;
  audioSrc: string | null;
};

/**
 * Video goes behind the captions and brings its own audio; anything else is
 * treated as an audio track over black.
 */
export const propsForInput = (publicName: string): ShortProps =>
  isVideo(publicName)
    ? { videoSrc: publicName, audioSrc: null }
    : { videoSrc: null, audioSrc: publicName };

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

/** Reads --from/--to out of argv and returns what is left. */
export const parseArgs = (
  argv: string[],
): { rest: string[]; window: ClipWindow } => {
  const rest: string[] = [];
  const window: ClipWindow = { clipStartMs: null, clipEndMs: null };

  for (const arg of argv) {
    const match = /^--(from|to)=(.+)$/.exec(arg);
    if (match === null) {
      rest.push(arg);
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
  return { rest, window };
};
