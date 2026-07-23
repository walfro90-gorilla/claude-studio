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
